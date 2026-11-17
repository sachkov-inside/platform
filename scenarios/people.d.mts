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

export const peopleDirectoryScenario: {
  readonly registeredEpoch: string;
  readonly activityEpoch: string;
};
export const peopleHistoryScenario: {
  readonly issuedAt: string;
  readonly revoke: { readonly at: string; readonly reason: string };
};
export const peopleCardScenario: {
  readonly registeredAt: string;
  readonly lastActivityAt: string;
  readonly paidAccess: {
    readonly access: "active";
    readonly revision: number;
    readonly origin: "paid";
  };
  readonly payments: readonly [
    {
      readonly amountKopecks: number;
      readonly state: "confirmed";
      readonly createdAt: string;
    },
    {
      readonly amountKopecks: number;
      readonly state: "failed";
      readonly createdAt: string;
    },
  ];
  readonly learning: {
    readonly startedAt: string;
    readonly read: number;
    readonly total: number;
  };
  readonly submissions: {
    readonly count: number;
    readonly lastSubmittedAt: string;
    readonly lastTaskCode: string;
  };
  readonly telegram: {
    readonly membership: "member";
    readonly restriction: "none";
    readonly marketing: "stopped";
    readonly observedAt: string;
    readonly joinReminders: { readonly sent: number; readonly lastAt: string };
  };
  readonly practiceWaitlist: {
    readonly intakeName: string;
    readonly active: true;
    readonly joinedAt: string;
  };
};
