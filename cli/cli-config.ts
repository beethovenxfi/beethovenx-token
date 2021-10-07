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
      MasterChef: "0x0e317Aa06F6C759a724ecD43548FB77bF5baC5b9",
      Timelock: "",
      BeethovenxToken: "0x819091705aAa56f87D02a5bB7a829550C8F5313D",
    },
  },
}
