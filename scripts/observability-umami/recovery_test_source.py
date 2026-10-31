"""Test-only historical foundation profile; never a current image/cache acceptance."""
from contextlib import ExitStack, contextmanager
import hashlib
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

import recovery

HISTORICAL_SOURCE = '3a501dcafb83b83c8b126147b11f50e484037185'
FIXTURES = Path(__file__).with_name('fixtures')/'foundation-2.57.0'


@contextmanager
def historical_foundation_source():
    """Read four real historical source copies through the unchanged runtime paths."""
    read_bytes, read_text = Path.read_bytes, Path.read_text
    provenance = json.loads(read_text(FIXTURES/'provenance.json'))
    lock = json.loads(read_text(recovery.CACHE_LOCK))
    if (set(provenance) != {'schema', 'source', 'inputs'}
            or type(provenance['schema']) is not int or provenance['schema'] != 1
            or provenance['source'] != HISTORICAL_SOURCE or lock['source'] != HISTORICAL_SOURCE
            or provenance['inputs'] != lock['inputs']
            or set(provenance['inputs']) != set(recovery.FOUNDATION_INPUTS)):
        raise ValueError('historical_foundation_provenance')
    contents = {}
    for relative, expected in provenance['inputs'].items():
        content = read_bytes(FIXTURES/Path(relative).name)
        if hashlib.sha256(content).hexdigest() != expected:
            raise ValueError('historical_foundation_fixture_changed')
        contents[relative] = content
    # Validate provenance before patching. Temporary copies let negative tests change
    # real source bytes without changing fixtures, globals, hashes or the validator.
    with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
        files = {relative: Path(directory)/Path(relative).name for relative in contents}
        for relative, path in files.items():
            path.write_bytes(contents[relative])
        projection = {recovery.ROOT/relative: path for relative, path in files.items()}
        def projected_bytes(path, *args, **kwargs):
            return read_bytes(projection.get(path, path), *args, **kwargs)
        def projected_text(path, *args, **kwargs):
            return read_text(projection.get(path, path), *args, **kwargs)
        stack.enter_context(patch.object(Path, 'read_bytes', projected_bytes))
        stack.enter_context(patch.object(Path, 'read_text', projected_text))
        yield files
