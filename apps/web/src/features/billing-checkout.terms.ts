// Узкий вход к срокам предложения продукта: страницы подставляют их в авторский текст, не втягивая
// клиентские модули оплаты в свой бандл.
export {
  fillOneTimeTerms,
  oneTimeOfferTerms,
  oneTimeTermLabels,
  type OneTimeOfferTerms,
} from "./billing-checkout/model/one-time-terms";
