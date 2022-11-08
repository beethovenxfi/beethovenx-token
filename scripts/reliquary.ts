import { BigNumber, ContractTransaction } from "ethers"
import { formatUnits, parseUnits } from "ethers/lib/utils"
import { ethers } from "hardhat"
import inquirer from "inquirer"
import { ADDRESS_ZERO, bn } from "../test/utilities"
import { ERC20, Reliquary } from "../types"

async function reliquary() {
  const contractAnswer = await inquirer.prompt([
    {
      name: "contractAddress",
      message: "contract address",
      type: "input",
      default: "0xb0FC43069089d0fA02baAa896ac2eFcb596D7D05",
    },
  ])
  const contract: Reliquary = (await ethers.getContractAt("Reliquary", contractAnswer.contractAddress)) as Reliquary

  const actionAnswer = await inquirer.prompt([
    {
      name: "action",
      message: "Action",
      type: "list",
      choices: [
        "add pool",
        "modify pool",
        "poolInfo",
        "deposit",
        "withdraw",
        "harvest",
        "pendingRewardsByRelicId",
        "pendingRewardsOfOwner",
        "relicPositionsOfOwner",
      ],
    },
  ])

  const relicIdQuestion = {
    name: "relicId",
    message: "relic Id",
    type: "input",
  }

  const recipientQuestion = {
    name: "recipient",
    message: "Recipient",
    type: "input",
    default: "0x4fbe899d37fb7514adf2f41b0630e018ec275a0c",
  }

  const amountQuestion = {
    name: "amount",
    message: "Amount (scientific notation > e.g. 1e18)",
    type: "input",
  }

  switch (actionAnswer.action) {
    case "add pool": {
      const addPoolAnswers = await inquirer.prompt([
        {
          name: "alloc",
          message: "allocation point",
          type: "input",
          default: "100",
        },
        {
          name: "poolToken",
          message: "Pool token (erc20)",
          type: "input",
        },
        {
          name: "rewarder",
          message: "Rewarder",
          type: "input",
          default: ADDRESS_ZERO,
        },
        {
          name: "requiredMaturity",
          message: "Required maturity (comma seperated)",
          type: "input",
          default: "0,3600,7200,10800,14400,86400,172800,259200,345600,604800",
        },
        {
          name: "allocPoints",
          message: "Allocation points (comma seperated)",
          type: "input",
          default: "10,20,30,40,50,60,70,80,90,100",
        },
        {
          name: "name",
          message: "name",
          type: "input",
        },
        {
          name: "nftDescriptor",
          message: "NFT Descriptor",
          type: "input",
          default: "0xfD24cEE5E16cb301bDFA201D37f7bF80581576Ec",
        },
      ])
      console.log(
        `Adding pool with 
        alloc: ${addPoolAnswers.alloc},
        pool token: ${addPoolAnswers.poolToken}, 
        rewarder: ${addPoolAnswers.rewarder}, 
        maturity: ${addPoolAnswers.requiredMaturity}, 
        allocation points: ${addPoolAnswers.allocPoints}
        name: ${addPoolAnswers.name}
        nftDescriptor: ${addPoolAnswers.nftDescriptor}`
      )

      const tx = await waitForTxReceipt(
        contract.addPool(
          addPoolAnswers.alloc,
          addPoolAnswers.poolToken,
          addPoolAnswers.rewarder,
          addPoolAnswers.requiredMaturity.split(","),
          addPoolAnswers.allocPoints.split(","),
          addPoolAnswers.name,
          addPoolAnswers.nftDescriptor
        )
      )
      console.log(`Added pool in tx ${tx}`)

      break
    }
    case "modify pool": {
      const modifyPoolAnswers = await inquirer.prompt([
        {
          name: "pid",
          message: "Pool ID",
          type: "input",
        },
        {
          name: "alloc",
          message: "allocation point",
          type: "input",
          default: "100",
        },
        {
          name: "rewarder",
          message: "Rewarder",
          type: "input",
          default: ADDRESS_ZERO,
        },
        {
          name: "name",
          message: "Name",
          type: "input",
        },
        {
          name: "nftDescriptor",
          message: "NFT Descriptor",
          type: "input",
          default: "0xfD24cEE5E16cb301bDFA201D37f7bF80581576Ec",
        },
        {
          name: "overrideRewarder",
          message: "Override Rewarder?",
          type: "input",
          default: "false",
        },
      ])
      console.log(
        `Modifying pool ${modifyPoolAnswers.pid} with 
        alloc: ${modifyPoolAnswers.alloc},
        rewarder: ${modifyPoolAnswers.rewarder}, 
        name: ${modifyPoolAnswers.name},
        nftDescriptor: ${modifyPoolAnswers.nftDescriptor},
        overrride Rewarder: ${modifyPoolAnswers.overrideRewarder}`
      )

      const tx = await waitForTxReceipt(
        contract.modifyPool(
          modifyPoolAnswers.pid,
          modifyPoolAnswers.alloc,
          modifyPoolAnswers.rewarder,
          modifyPoolAnswers.name,
          modifyPoolAnswers.nftDescriptor,
          modifyPoolAnswers.overrideRewarder
        )
      )
      console.log(`Modified pool in tx ${tx}`)

      break
    }
    case "deposit": {
      const depositAnswers = await inquirer.prompt([
        {
          name: "mint",
          message: "Mint new relic?",
          type: "confirm",
        },
        amountQuestion,
        {
          ...relicIdQuestion,
          when: (answers) => !answers.mint,
        },
        {
          name: "pid",
          message: "poolId",
          type: "input",
          when: (answers) => answers.mint,
        },
        {
          ...recipientQuestion,
          when: (answers) => answers.mint,
        },
        {
          name: "approve",
          message: "approve amount",
          type: "confirm",
        },
      ])
      const amount = parseAmount(depositAnswers.amount)

      if (depositAnswers.approve) {
        let pid: string
        if (depositAnswers.mint) {
          pid = depositAnswers.pid
        } else {
          const position = await contract.getPositionForId(depositAnswers.relicId)
          pid = position.poolId.toString()
        }
        const poolTokenAddress = await contract.poolToken(pid)
        const poolToken = (await ethers.getContractAt("ERC20", poolTokenAddress)) as ERC20
        console.log(`Approving pool token ${poolTokenAddress} for amount ${amount.toString()} to spender ${contractAnswer.contractAddress}`)
        const tx = await waitForTxReceipt(poolToken.approve(contractAnswer.contractAddress, amount))
        console.log(`Done with tx ${tx}`)
        console.log("Waiting a bit for tx confirmations")
        await new Promise((resolve) => {
          setTimeout(resolve, 5000)
        })
      }

      if (depositAnswers.mint) {
        console.log("Create relic and deposit...")
        const tx = await waitForTxReceipt(contract.createRelicAndDeposit(depositAnswers.recipient, depositAnswers.pid, amount))
        console.log(
          `Minted ${depositAnswers.amount} pool token to ${depositAnswers.recipient} in new relic for pool ${depositAnswers.pid} in tx ${tx}`
        )
      } else {
        console.log("Deposit to existing relic...")

        const tx = await waitForTxReceipt(contract.deposit(amount, depositAnswers.relicId))
        console.log(`Deposited ${depositAnswers.amount} to relic ${depositAnswers.relicId} in tx ${tx}`)
      }
      break
    }
    case "withdraw": {
      const withdrawAnswers = await inquirer.prompt([
        relicIdQuestion,
        amountQuestion,
        {
          name: "harvest",
          message: "harvest",
          type: "confirm",
        },
        {
          ...recipientQuestion,
          when: (answers) => answers.harvest,
        },
      ])
      const amount = parseAmount(withdrawAnswers.amount)
      if (withdrawAnswers.harvest) {
        console.log("Withdrawing and harvesting...")

        const tx = await waitForTxReceipt(contract.withdrawAndHarvest(amount, withdrawAnswers.relicId, withdrawAnswers.recipient))
        console.log(
          `Withdrawn ${withdrawAnswers.amount} from relic ${withdrawAnswers.relicId} and harvested to ${withdrawAnswers.recipient} in tx ${tx}`
        )
      } else {
        console.log("Withdrawing...")

        const tx = await waitForTxReceipt(contract.withdraw(amount, withdrawAnswers.relicId))
        console.log(`Withdrawn ${withdrawAnswers.amount} from relic ${withdrawAnswers.relicId} without harvessting in tx ${tx}`)
      }
      break
    }
    case "harvest": {
      const harvestAnswers = await inquirer.prompt([relicIdQuestion, recipientQuestion])
      console.log("Harvesting...")

      const tx = await waitForTxReceipt(contract.harvest(harvestAnswers.relicId, harvestAnswers.recipient))
      console.log(`Harvested from relic ${harvestAnswers.relicId} to ${harvestAnswers.recipient} in tx ${tx}`)
      break
    }
    case "pendingRewardsByRelicId": {
      const pendingRewardsAnswers = await inquirer.prompt([relicIdQuestion])
      const pendingRewards = await contract.pendingReward(pendingRewardsAnswers.relicId)
      console.log(`Pending rewards for relic ${pendingRewardsAnswers.relicId} : ${formatUnits(pendingRewards)}`)
      break
    }
    case "pendingRewardsOfOwner": {
      const pendingRewardsAnswers = await inquirer.prompt([{ name: "owner", message: "owner", type: "input" }])
      const rewards = await contract.pendingRewardsOfOwner(pendingRewardsAnswers.owner)
      console.log("Pending rewards for owner ", pendingRewardsAnswers.owner)

      for (let relicReward of rewards) {
        console.log(
          `Relic ${relicReward.relicId.toString()} > pid ${relicReward.poolId.toString()} > rewards: ${formatUnits(relicReward.pendingReward)}`
        )
      }
      break
    }
    case "relicPositionsOfOwner": {
      const positionsAnswer = await inquirer.prompt([{ name: "owner", message: "owner", type: "input" }])
      const relicPositions = await contract.relicPositionsOfOwner(positionsAnswer.owner)
      const relicIds = relicPositions.relicIds
      const positionInfos = relicPositions.positionInfos
      console.log(`Positions for owner ${positionsAnswer.owner}`)

      relicIds.forEach((relicId, index) => {
        console.log(
          `Relic ${relicId.toString()} > pid ${positionInfos[index].poolId.toString()} > amount: ${formatUnits(
            positionInfos[index].amount
          )} > level ${positionInfos[index].level} > entry ${positionInfos[index].entry}`
        )
      })
      break
    }
    case "poolInfo": {
      const poolInfoAnswers = await inquirer.prompt([{ name: "poolId", message: "pool ID", type: "input" }])
      const poolInfo = await contract.getPoolInfo(poolInfoAnswers.poolId)
      console.log(`Pool info for pid ${poolInfoAnswers.poolId},
      name: ${poolInfo.name}
      allocation points: ${poolInfo.allocPoint},
      accRewardsPerShaer: ${poolInfo.accRewardPerShare}
      lastRewardTime: ${poolInfo.lastRewardTime}`)
      break
    }
  }
}

reliquary().catch((error) => console.error(error))

async function waitForTxReceipt(tx: Promise<ContractTransaction>): Promise<string> {
  const receipt = await (await tx).wait()
  return receipt.transactionHash
}

function parseAmount(amount: string): BigNumber {
  const [number, decimals = "18"] = amount.split("e")
  return bn(number, parseInt(decimals))
}
