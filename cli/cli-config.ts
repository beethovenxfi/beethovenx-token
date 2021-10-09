type CliConfigContent = {
  contractAddresses: {
    MasterChef: string
    Timelock: string
    BeethovenxToken: string
    BeetsLp: string
    TeamVesting: string
  }
  walletAddresses: {
    treasury: string
    partnership: string
    team: string
  }
}

type CliConfig = Record<number, CliConfigContent>

export const scriptConfig: CliConfig = {
  250: {
    contractAddresses: {
      MasterChef: "0x8166994d9ebBe5829EC86Bd81258149B87faCfd3",
      Timelock: "0xb5caee3cd5d86c138f879b3abc5b1bebb63c6471",
      BeethovenxToken: "0xF24Bcf4d1e507740041C9cFd2DddB29585aDCe1e",
      BeetsLp: "0x03c6B3f09D2504606936b1A4DeCeFaD204687890",
      TeamVesting: "0xa2503804ec837D1E4699932D58a3bdB767DeA505",
    },
    walletAddresses: {
      treasury: "0xa1e849b1d6c2fd31c63eef7822e9e0632411ada7",
      partnership: "0x69739a7618469EED0685330d164D50Ac19A9411a",
      team: "0x0EDfcc1b8D082Cd46d13Db694b849D7d8151C6D5",
    },
  },
  4: {
    contractAddresses: {
      MasterChef: "0x64CBF3dbee116167Dd41Abd143405B511c436076",
      Timelock: "0xa2f273656b1989d10fA36274Ca9c3c851D4f1928",
      BeethovenxToken: "0x51929Da9218898b4dfaB4AE5Db56b0A61158A613",
      BeetsLp: "0x33276d43ada054a281d40a11d48310cdc0156fc2",
      TeamVesting: "",
    },
    walletAddresses: {
      treasury: "",
      partnership: "",
      team: "",
    },
  },
}
