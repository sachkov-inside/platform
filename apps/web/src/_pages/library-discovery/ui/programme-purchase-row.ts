/**
 * Место кнопки оплаты в шапке программы: справа в ряду с названием, а на узком экране — отдельной
 * строкой во всю ширину. Заготовка на время загрузки занимает то же место, поэтому шапка не прыгает.
 */
export const programmePurchaseRowClass =
  "col-span-full flex min-h-11 min-w-0 @[36rem]/programme:col-span-1 @[36rem]/programme:justify-end [&>*]:w-full @[36rem]/programme:[&>*]:w-auto";

/**
 * Предзаказ занимает больше места — цена, зачёркнутая цена и кнопка, — поэтому всегда стоит
 * отдельной строкой под названием: иначе на ширине программы название сжимается до столбика.
 */
export const programmePreorderRowClass =
  "col-span-full flex min-w-0 [&>*]:w-full";
