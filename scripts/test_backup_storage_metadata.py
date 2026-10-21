"""Provider metadata projection with a read-only network double."""
import importlib.util
import pathlib
import unittest
import xml.etree.ElementTree as ET

SPEC = importlib.util.spec_from_file_location(
    "storage_metadata", pathlib.Path(__file__).with_name("backup-storage-metadata.py"))
metadata = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(metadata)


class StorageProjection(unittest.TestCase):
    def fixture(self, lifecycle):
        def fetch(query):
            if query == "lifecycle=":
                return lifecycle
            if query == "versioning=":
                return 200, ET.fromstring("<VersioningConfiguration/>")
            if "inside-platform-v2" in query:
                return 200, ET.fromstring("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>")
            return 200, ET.fromstring("<ListBucketResult><Contents><StorageClass>STANDARD</StorageClass><Key>PRIVATE</Key></Contents></ListBucketResult>")
        return fetch

    def test_known_absent_lifecycle_and_empty_new_namespace_are_projected_without_payload(self):
        result = metadata.summarize(self.fixture((404, ET.fromstring(
            "<Error><Code>NoSuchLifecycleConfiguration</Code><Message>PRIVATE</Message></Error>"))))
        self.assertTrue(result["noConfiguredLifecycle"])
        self.assertTrue(result["newPrefixEmpty"])
        self.assertNotIn("PRIVATE", str(result))

    def test_access_denied_does_not_become_absent_lifecycle(self):
        result = metadata.summarize(self.fixture((403, ET.fromstring(
            "<Error><Code>AccessDenied</Code><Message>PRIVATE</Message></Error>"))))
        self.assertFalse(result["noConfiguredLifecycle"])
        self.assertNotIn("PRIVATE", str(result))


if __name__ == "__main__":
    unittest.main()
