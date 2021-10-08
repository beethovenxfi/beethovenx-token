type CliConfigContent = {
  contractAddresses: {
    MasterChef: string
    Timelock: string
    BeethovenxToken: string
    BeetsLp: string
  }
}

type CliConfig = Record<number, CliConfigContent>

export const scriptConfig: CliConfig = {
  250: {
    contractAddresses: {
      MasterChef: "0x8166994d9ebBe5829EC86Bd81258149B87faCfd3",
      Timelock: "0xb5caee3cd5d86c138f879b3abc5b1bebb63c6471",
      BeethovenxToken: "0xF24Bcf4d1e507740041C9cFd2DddB29585aDCe1e",
      BeetsLp: "",
    },
  },
  4: {
    contractAddresses: {
      MasterChef: "0x0e317Aa06F6C759a724ecD43548FB77bF5baC5b9",
      Timelock: "",
      BeethovenxToken: "0x819091705aAa56f87D02a5bB7a829550C8F5313D",
      BeetsLp: "0x33276d43ada054a281d40a11d48310cdc0156fc2",
    },
  },
}
