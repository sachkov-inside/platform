export const peopleScenario: {
  readonly anna: {
    readonly displayName: string;
    readonly username: string;
    readonly email: string;
    readonly contactsState: "complete";
  };
  readonly konstantin: {
    readonly displayName: string;
    readonly username: null;
    readonly email: string;
    readonly contactsState: "complete";
  };
  readonly newcomer: {
    readonly displayName: null;
    readonly username: null;
    readonly email: string;
    readonly contactsState: "partial";
  };
  readonly directoryNames: readonly string[];
  readonly paymentBuyerNames: readonly [string, string];
  readonly products: readonly [
    ScenarioPersonProduct,
    ScenarioPersonProduct,
    ScenarioPersonProduct,
    ScenarioPersonProduct,
  ];
};
interface ScenarioPersonProduct {
  readonly name: string;
  readonly longName: string;
  readonly archived: boolean;
}
