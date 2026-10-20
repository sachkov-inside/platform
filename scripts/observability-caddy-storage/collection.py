"""Only complete validated Caddy records cross the private/public boundary."""
import artifact
import ci

ARTIFACTS = ('evidence.json', 'cleanup.json', 'worker-outcome.json', 'recovery.json')


def collect(output, metadata, destination):
    observation = artifact.read(output)
    run = artifact.read_run(output)
    if (observation is not None and run is None
            or run is not None and run['state'] == 'passed' and (
                observation is None or observation['state'] != 'observed'
                or observation['transport'] != {'canonical': 'passed', 'mcp': 'passed'})):
        artifact.refuse()
    # All new raw records are validated before the existing collector creates a destination.
    ci.collect(output, metadata, destination, artifacts=ARTIFACTS)
    if run is not None:
        artifact.write_run(destination, run)
    if observation is not None:
        artifact.write(destination, observation)
