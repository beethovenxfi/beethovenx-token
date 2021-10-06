import { BigNumber } from "ethers"
import { ethers, network } from "hardhat"
import { BeethovenxMasterChef, ERC20, MasterChefLpTokenTimelock } from "../types"
import { bn } from "../test/utilities"

type DistributionConfig = {
  lpToken: string
  masterChef: string
  distribution: { percentage: number; beneficiary: string; vestingContract: string }[]
}

const fundDistributionConfig: Record<number, DistributionConfig> = {
  4: {
    lpToken: "",
    masterChef: "",
    distribution: [
      { percentage: 500, vestingContract: "", beneficiary: "0xae1fa6dcb9fc88718ec6c10f334305e2182e9466" },
      {
        percentage: 200,
        vestingContract: "",
        beneficiary: "",
      },
      {
        percentage: 100,
        vestingContract: "",
        beneficiary: "0xC84f644BBe4dca6DF7441463472817211637F99b",
      },
      {
        percentage: 100,
        vestingContract: "",
        beneficiary: "0x2f07C8De8b633a7B4278B28C09a654295D8eEefb",
      },
      {
        percentage: 100,
        vestingContract: "",
        beneficiary: " 0x5aa1039D09330DF607F88e72bb9C1E0F66C96AA0",
      },
    ],
  },
}

async function vestFundLps() {
  const config = fundDistributionConfig[network.config.chainId!]
  verifyTotalPercentage(config)

  const [_, _a, lbpFund] = await ethers.getSigners()

  const chef = (await ethers.getContractAt("BeethovenxMasterChef", config.masterChef)) as BeethovenxMasterChef
  const beetsUsdcLp = (await ethers.getContractAt("ERC20", config.lpToken)) as ERC20
  const balance = await beetsUsdcLp.balanceOf(lbpFund.address)

  for (let distribution of config.distribution) {
    const vestingContract = (await ethers.getContractAt("MasterChefLpTokenTimelock", distribution.vestingContract)) as MasterChefLpTokenTimelock
    /*
      we double check if the configured beneficiary matches the beneficiary of the vesting contract
     */
    const beneficiary = await vestingContract.beneficiary()
    if (distribution.beneficiary !== beneficiary) {
      throw new Error(`Beneficiary not matching, expected: ${distribution.beneficiary}, actual: ${beneficiary}`)
    }

    const lpShareAmount = percentageOf(balance, distribution.percentage)

    /*
        now we check if this vesting contract has already deposited to master chef, if so we skip
     */
    const userInfo = await chef.userInfo(await vestingContract.masterChefPoolId(), vestingContract.address)

    if (userInfo.amount.gt(bn(0))) {
      console.log(
        `Vesting contract ${
          vestingContract.address
        } has already ${userInfo.amount.toString()} of ${lpShareAmount.toString()} on master chef! skipping`
      )
    } else {
      /*
          ok we should be good to go, lets do it!
       */
      await beetsUsdcLp.connect(lbpFund).approve(vestingContract.address, lpShareAmount)
      const tx = await vestingContract.depositAllToMasterChef(lpShareAmount)
      const receipt = await tx.wait()

      console.log(`Deposited ${lpShareAmount} to vesting contract ${vestingContract.address} with tx: ${receipt.transactionHash}`)
    }
  }
}

function percentageOf(value: BigNumber, percentage: number) {
  return value.mul(percentage).div(1000)
}

function verifyTotalPercentage(config: DistributionConfig) {
  const total = config.distribution.reduce((sum, nextVal) => sum + nextVal.percentage, 0)
  if (total !== 1000) {
    throw new Error("invalid percentage config")
  }
}
