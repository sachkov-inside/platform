// Sales Funnel hands its transaction to Telegram; it cannot inspect Telegram rows itself.
export async function readBindingByHand(transaction:{telegramAccountLinkState:{findUnique(input:unknown):Promise<unknown>}}):Promise<void>{
 await transaction.telegramAccountLinkState.findUnique({where:{}});
}
