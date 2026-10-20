#!/usr/bin/env python3
"""Exercise first email attachment against disposable Logto, PostgreSQL and Mailpit."""
import argparse
import base64
import concurrent.futures
import json
import re
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True, stderr=subprocess.PIPE).strip()


def port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def request(url, body=None, token=None, form=False, basic=None, method=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if basic:
        headers["Authorization"] = "Basic " + base64.b64encode(basic.encode()).decode()
    if body is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
        body = (urllib.parse.urlencode(body) if form else json.dumps(body)).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    data = response.read()
    return response.status, json.loads(data) if data else None


def wait_for(operation, description):
    deadline = time.monotonic() + 180
    last = None
    while time.monotonic() < deadline:
        try:
            return operation()
        except Exception as error:
            last = error
            time.sleep(1)
    raise RuntimeError(f"Timed out waiting for {description}") from last


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", default="inside-profile-logto:task")
    args = parser.parse_args()
    task = "inside-profile-proof-" + uuid.uuid4().hex[:8]
    names = []
    endpoint_port, admin_port, mail_port = port(), port(), port()
    endpoint = f"http://127.0.0.1:{endpoint_port}"
    admin = f"http://127.0.0.1:{admin_port}"
    mail = f"http://127.0.0.1:{mail_port}"
    docker("network", "create", task)
    try:
        def run(name, *arguments):
            names.append(name)
            return docker("run", "-d", "--name", name, "--network", task, "--label", f"inside.task={task}", *arguments)

        db_name = task + "-db"
        run(db_name, "-e", "POSTGRES_USER=logto", "-e", "POSTGRES_PASSWORD=proof", "-e", "POSTGRES_DB=logto",
            "public.ecr.aws/docker/library/postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94")
        run(task + "-mail", "--network-alias", "mailpit", "-p", f"127.0.0.1:{mail_port}:8025",
            "ghcr.io/axllent/mailpit:v1.30.6@sha256:7f33095f80e901f6ad08028f06ca284aa58fe84942be5496008d041d3b9f4d4d")
        wait_for(lambda: docker("exec", db_name, "pg_isready", "-U", "logto"), "PostgreSQL")
        run(task + "-idp", "-p", f"127.0.0.1:{endpoint_port}:3001", "-p", f"127.0.0.1:{admin_port}:3002",
            "-e", f"DB_URL=postgres://logto:proof@{db_name}:5432/logto", "-e", f"ENDPOINT={endpoint}",
            "-e", f"ADMIN_ENDPOINT={admin}", "--entrypoint", "sh", args.image, "-c",
            "npm run cli db seed -- --swe --disable-admin-pwned-password-check && npm run alteration deploy 1.44.0 && npm start")
        def readiness():
            status, body = request(endpoint + "/oidc/.well-known/openid-configuration")
            assert status == 200
            return body
        wait_for(readiness, "Logto")
        secret = docker("exec", db_name, "psql", "-U", "logto", "-Atc", "select secret from applications where tenant_id='admin' and id='m-default'")
        status, token = request(admin + "/oidc/token", {
            "grant_type": "client_credentials", "resource": "https://default.logto.app/api", "scope": "all"
        }, form=True, basic="m-default:" + secret)
        assert status == 200, (status, token)
        management_token = token["access_token"]
        def api(path, body=None, method=None):
            status, data = request(endpoint + "/api" + path, body, management_token, method=method)
            assert 200 <= status < 300, (path, status, data)
            return data
        api("/account-center", {"enabled": True, "fields": {"email": "Edit"}}, "PATCH")
        api("/connectors", {"connectorId": "simple-mail-transfer-protocol", "config": {
            "host": "mailpit", "port": 1025, "auth": {"type": "login"}, "fromEmail": "proof@example.test", "secure": False, "ignoreTLS": True,
            "templates": [{"usageType": usage, "contentType": "text/plain", "subject": "Profile proof", "content": "Code: {{code}}"} for usage in ["BindNewIdentifier", "SignIn", "Register", "ForgotPassword", "Generic"]]
        }})
        application = api("/applications", {"name": "Profile proof", "type": "Traditional", "oidcClientMetadata": {"redirectUris": [endpoint + "/callback"], "postLogoutRedirectUris": [endpoint + "/"]}})
        app_id = application["id"]
        app_secret = api("/applications/" + app_id + "/secrets")[0]["value"]

        def user(label, email=None):
            data = {"name": label, "username": label.replace("-", "_")}
            if email:
                data["primaryEmail"] = email
            result = api("/users", data)
            api("/users/" + result["id"] + "/identities/inside-telegram", {"userId": str(uuid.uuid4()), "details": {"name": label}}, "PUT")
            return result["id"]

        def user_token(user_id):
            subject = api("/subject-tokens", {"userId": user_id})["subjectToken"]
            status, data = request(endpoint + "/oidc/token", {
                "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange", "subject_token": subject,
                "subject_token_type": "urn:ietf:params:oauth:token-type:access_token", "scope": "openid email"
            }, form=True, basic=app_id + ":" + app_secret)
            assert status == 200, (status, data)
            return data["access_token"]

        first_id, second_id = user("profile-one"), user("profile-two")
        first, second = user_token(first_id), user_token(second_id)
        def start(token, email):
            status, data = request(endpoint + "/api/my-account/first-email/start", {"email": email}, token)
            assert status == 201, (status, data)
            return data["verificationRecordId"]
        def confirm(token, challenge, code):
            return request(endpoint + "/api/my-account/first-email/confirm", {"verificationRecordId": challenge, "code": code}, token)
        def code(email):
            def find():
                status, data = request(mail + "/api/v1/messages")
                assert status == 200
                message = next(item for item in data["messages"] if any(recipient["Address"].lower() == email for recipient in item["To"]))
                _, detail = request(mail + "/api/v1/message/" + message["ID"])
                return re.search(r"\b[0-9]{6}\b", detail["Text"])[0]
            return wait_for(find, "verification email")

        address = "first@example.test"
        challenge = start(first, address)
        correct = code(address)
        assert confirm(second, challenge, correct)[0] >= 400, "Another user used the challenge"
        wrong = "000000" if correct != "000000" else "111111"
        assert confirm(first, challenge, wrong)[0] >= 400, "Wrong code accepted"
        assert confirm(first, challenge, correct)[0] == 204
        assert confirm(first, challenge, correct)[0] == 204, "Lost-response retry failed"
        status, info = request(endpoint + "/oidc/me", token=first)
        assert status == 200 and info["sub"] == first_id and info["email"] == address
        assert request(endpoint + "/api/my-account/first-email/start", {"email": "replacement@example.test"}, first)[0] >= 400
        occupied = start(second, address)
        assert confirm(second, occupied, code(address))[0] == 422, "Another user's email transferred"
        assert "primaryEmail" not in api("/users/" + second_id) or api("/users/" + second_id)["primaryEmail"] is None
        assert request(endpoint + "/api/my-account/first-email/start", {"email": "anonymous@example.test"})[0] == 401

        concurrent_id = user("profile-concurrent")
        concurrent_token = user_token(concurrent_id)
        left, right = "left@example.test", "right@example.test"
        challenges = [(start(concurrent_token, email), code(email)) for email in [left, right]]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            outcomes = list(executor.map(lambda pair: confirm(concurrent_token, *pair)[0], challenges))
        assert sorted(outcomes) == [204, 422], outcomes
        assert api("/users/" + concurrent_id)["primaryEmail"] in [left, right]

        expired = start(second, "expired@example.test")
        expired_code = code("expired@example.test")
        docker("exec", db_name, "psql", "-U", "logto", "-c", f"update verification_records set expires_at=0 where id='{expired}'")
        assert confirm(second, expired, expired_code)[0] >= 400
        print("PASS: own email, same subject, wrong code, foreign challenge, occupied email, retry, no replacement, anonymous, concurrency, expiration", flush=True)
    except Exception:
        if task + "-idp" in names:
            print(docker("logs", "--tail", "35", task + "-idp"))
        raise
    finally:
        for name in reversed(names):
            subprocess.run(["docker", "rm", "-f", "-v", name], check=False, capture_output=True)
        docker("network", "rm", task)
        assert not docker("ps", "-aq", "--filter", f"label=inside.task={task}")
        print("Disposable profile proof containers and network removed.", flush=True)


if __name__ == "__main__":
    main()
