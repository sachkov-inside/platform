# Glossary Map

## Contexts

- [Inside and Platform](./GLOSSARY.md): shared Inside terms and their Platform refinements.
- [Telegram application](./apps/telegram/GLOSSARY.md): terms local to the Telegram bot.

## Relationships

[The context map](docs/product/domain-context-map.md) names state owners and the target direction
of Module interactions. It is an architecture map, separate from the two language contexts here.

- **Platform → Telegram**: Telegram reuses the shared meanings from the root glossary, including
  Product, TelegramIdentity, MembershipObservation and CommunityEntitlement, and defines only its
  own local terms.
