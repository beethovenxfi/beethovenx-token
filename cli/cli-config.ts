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
      BeetsLp: "0x03c6B3f09D2504606936b1A4DeCeFaD204687890",
    },
  },
  4: {
    contractAddresses: {
      MasterChef: "0x64CBF3dbee116167Dd41Abd143405B511c436076",
      Timelock: "0xa2f273656b1989d10fA36274Ca9c3c851D4f1928",
      BeethovenxToken: "0x51929Da9218898b4dfaB4AE5Db56b0A61158A613",
      BeetsLp: "0x33276d43ada054a281d40a11d48310cdc0156fc2",
    },
  },
}
