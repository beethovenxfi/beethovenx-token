export type ScriptContractName = "Authorizer" | "Vault" | "Timelock" | "ProtocolFeesCollector"

type CliConfigContent = {
  contractAddresses: {
    MasterChef: string
    Timelock: string
    BeethovenxToken: string
  } & Record<string, string>
}

type CliConfig = Record<number, CliConfigContent>

export const scriptConfig: CliConfig = {
  250: {
    contractAddresses: {
      MasterChef: "",
      Timelock: "",
      BeethovenxToken: "",
    },
  },
  4: {
    contractAddresses: {
      MasterChef: "0x748802AC3cBA3cEa85791b94F71d1Aa33F2a8233",
      Timelock: "",
      BeethovenxToken: "0xe4B88E745Dce9084B9fc2439F85A9a4C5CD6f361",
    },
  },
}
