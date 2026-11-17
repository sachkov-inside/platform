# External video protocol fixture

`iframe.player-2.202.2.js.txt` contains the genuine, unmodified Kinescope iframe SDK downloaded
2026-11-17 from https://player.kinescope.io/latest/iframe.player.js.
Release embedded in the artifact: `2.202.2`.
SHA-256: `aa0975dfeb310809a5000d8d091df2b33623ff70a69dbccf8a48acb523fe8e58`.
The fixture verifies that digest before serving the artifact at the production script URL.

The production feature loader and installed `@kinescope/player-iframe-api-loader@0.9.0` execute
unchanged. The fixture substitutes the external embed HTML, implements the SDK's external
MessageChannel handshake, replies to player method requests, and emits provider events.
Protocol observation follows the pinned artifact; the public methods/events are documented at
https://docs.kinescope.com/player-docs/embedding/iframe-api/.

This proves the application's integration with that SDK, its real iframe construction, method
promises, subscriptions and destruction. It does not prove video decoding, DRM licences, paid
provider access, or backend persistence. Test stimuli enter only the synthetic external iframe;
observation messages expose received provider methods to the test, never replace SDK methods.
