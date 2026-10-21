#!/usr/bin/env python3
"""GET-only Yandex backup bucket metadata. Consume existing credentials locally, never emit them."""
import datetime
import hashlib
import hmac
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

QUERIES = ("lifecycle=", "versioning=", "list-type=2&max-keys=1&prefix=inside-platform-v2%2F",
           "list-type=2&max-keys=1&prefix=inside-platform%2F")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, _request, _fp, _code, _message, _headers, _newurl):
        raise ValueError("metadata redirects are forbidden")


def summarize(fetch):
    replies = [fetch(query) for query in QUERIES]
    code, lifecycle = replies[0]
    absent = (code == 404 and lifecycle is not None
              and lifecycle.findtext("Code") == "NoSuchLifecycleConfiguration")
    result = {"lifecycleHttpStatus": code, "noConfiguredLifecycle": absent,
              "rawPayloadRetained": False, "lifecycleRulesNeedReview": not absent}
    if code == 200 and lifecycle is not None:
        # Do not publish arbitrary rule IDs, prefixes or tag values.
        rules = lifecycle.findall("Rule")
        result["enabledLifecycleRules"] = sum(rule.findtext("Status") == "Enabled" for rule in rules)
        result["expirationRules"] = sum(rule.find("Expiration") is not None for rule in rules)
        result["noncurrentExpirationRules"] = sum(rule.find("NoncurrentVersionExpiration") is not None for rule in rules)
    code, versioning = replies[1]
    result["versioningHttpStatus"] = code
    if code == 200 and versioning is not None:
        status = versioning.findtext("Status") or "unconfigured"
        result["versioningStatus"] = status if status in ("Enabled", "Suspended", "unconfigured") else "unknown"
    code, prefix = replies[2]
    result["newPrefixProbeHttpStatus"] = code
    result["newPrefixEmpty"] = (code == 200 and prefix is not None
                                 and prefix.findtext("IsTruncated") == "false" and not prefix.findall("Contents"))
    code, objects = replies[3]
    result["classProbeHttpStatus"] = code
    if code == 200 and objects is not None:
        value = objects.findtext("Contents/StorageClass") or "unknown"
        result["sampleStorageClass"] = value if value in ("STANDARD", "COLD", "ICE", "INTELLIGENT_TIERING") else "unknown"
    result.update(provider="Yandex Object Storage", region="ru-central1", repositoryAlias="existing-backup-bucket",
                  observedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    return result


def client():
    values = {}
    allowed = {"PGBACKREST_REPO1_S3_BUCKET", "PGBACKREST_REPO1_S3_KEY", "PGBACKREST_REPO1_S3_KEY_SECRET"}
    for name in ("database.env", "pgbackrest.env"):
        for line in pathlib.Path("/etc/inside/foundation", name).read_text().splitlines():
            key, sep, value = line.partition("=")
            if sep and key in allowed:
                values[key] = value.strip().strip('"').strip("'")
    if set(values) != allowed or not all(values.values()):
        raise ValueError("existing storage credentials unavailable")
    opener = urllib.request.build_opener(NoRedirect())

    def fetch(query):
        if query not in QUERIES:
            raise ValueError("unsupported metadata query")
        now = datetime.datetime.now(datetime.timezone.utc)
        date, stamp = now.strftime("%Y%m%d"), now.strftime("%Y%m%dT%H%M%SZ")
        endpoint = "storage.yandexcloud.net"
        path = "/" + urllib.parse.quote(values["PGBACKREST_REPO1_S3_BUCKET"], safe="")
        scope = date + "/ru-central1/s3/aws4_request"
        payload = hashlib.sha256(b"").hexdigest()
        headers = "host:" + endpoint + "\nx-amz-content-sha256:" + payload + "\nx-amz-date:" + stamp + "\n"
        canonical = "GET\n" + path + "\n" + query + "\n" + headers + "\nhost;x-amz-content-sha256;x-amz-date\n" + payload
        def mac(key, message):
            return hmac.new(key, message.encode(), hashlib.sha256).digest()
        signing = mac(mac(mac(mac(("AWS4" + values["PGBACKREST_REPO1_S3_KEY_SECRET"]).encode(), date), "ru-central1"), "s3"), "aws4_request")
        signature = hmac.new(signing, ("AWS4-HMAC-SHA256\n" + stamp + "\n" + scope + "\n" + hashlib.sha256(canonical.encode()).hexdigest()).encode(), hashlib.sha256).hexdigest()
        authorization = ("AWS4-HMAC-SHA256 Credential=" + values["PGBACKREST_REPO1_S3_KEY"] + "/" + scope
                         + ", SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=" + signature)
        request = urllib.request.Request("https://" + endpoint + path + "?" + query, method="GET",
                                         headers={"Authorization": authorization, "x-amz-date": stamp,
                                                  "x-amz-content-sha256": payload})
        try:
            try:
                response = opener.open(request, timeout=15)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                code = response.code
                body = response.read(1024 * 1024 + 1)
            if len(body) > 1024 * 1024:
                return code, None
            root = ET.fromstring(body)
            for element in root.iter():
                element.tag = element.tag.split("}")[-1]
            return code, root
        except (OSError, ValueError, ET.ParseError):
            return 0, None
    return fetch


if __name__ == "__main__":
    try:
        print(json.dumps(summarize(client()), indent=2))
    except (OSError, ValueError, KeyError):
        print("storage metadata unavailable; no raw diagnostics retained", file=sys.stderr)
        sys.exit(1)
