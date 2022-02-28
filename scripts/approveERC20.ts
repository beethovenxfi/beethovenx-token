import inquirer from "inquirer"
import { ethers } from "hardhat"
import { bn } from "../test/utilities"

async function approve() {
  const answers = await inquirer.prompt([
    {
      name: "contractAddress",
      message: "contract address",
      type: "input",
    },
    {
      name: "spender",
      message: "spender",
      type: "input",
    },
    {
      name: "amount",
      message: "amount (without decimals)",
      type: "input",
    },
  ])

  const contract = await ethers.getContractAt("ERC20", answers.contractAddress)

  const tx = await contract.approve(answers.spender, bn(answers.amount))
  const receipt = await tx.wait()
  console.log("Done with tx", receipt.transactionHash)
}

approve().catch((error) => console.error(error))
