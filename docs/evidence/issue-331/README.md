# Personal Home proof — #331

Production-owned `ContinueLearning` is composed before the accepted public content hub. Fixtures
exercise anonymous, signed-in empty, free non-member, member, expired, text without position,
partial video, reached-end-unmarked, completed exclusion, unavailable Videos fallback and failure.
The presentation does not infer membership or completion; adapters supply the eligible items.

The first production view is resolved on the server (#332). Refresh keeps the previous content;
the loading state is an overlay over that explicit content, so it does not guess the card count.
Playwright checks the Series heading position for ready/empty/error refresh transitions. Removing
an explicitly completed item changes the content intentionally.

Validation: 32 responsive/axe/keyboard Playwright checks at 390×844 and 1440×1024; 12 Storybook
interaction states. Keyboard checks use Tab/Space/Enter, including navigation after card removal.
The screenshot corpus records the production-owned presentation; it is fixture proof, not live
backend proof. Production evidence is delivered separately in #332.

Owner visual GO is pending. Automated checks and agent inspection do not replace that decision.
Review surface: http://localhost:6011/?path=/story/pages-personal-home--member (Agentation enabled).
