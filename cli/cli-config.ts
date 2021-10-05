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
      MasterChef: "0xde37A65C454EB4b0FA0622e47b4B75fc23525b19",
      Timelock: "0x9b8bd01C1B8406ac2D006F9dF84ad22623DF220f",
      BeethovenxToken: "0x3E3a61eC8F9D2E677bfc6f8F044B70e3C153eBED",
    },
  },
}
