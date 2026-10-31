"""Wire credentials accepted by the pinned Umami API and private pilot state."""
CREDENTIAL_BYTES = 8192
NATIVE_KEY_PREFIX = 'umami_'
NATIVE_KEY_RANDOM_CHARACTERS = 32


def credential(value):
    if not isinstance(value, str) or not value or len(value) > CREDENTIAL_BYTES or any(ord(char) < 33 or ord(char) > 126 for char in value):
        raise ValueError('credential')
    return value


def native_key(value):
    credential(value)
    suffix = value[len(NATIVE_KEY_PREFIX):]
    if not value.startswith(NATIVE_KEY_PREFIX) or len(suffix) != NATIVE_KEY_RANDOM_CHARACTERS or not suffix.isalnum():
        raise ValueError('native_key')
    return value
