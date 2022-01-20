import inquirer from "inquirer"
import { ethers } from "hardhat"

async function transferOwnership() {
  const answers = await inquirer.prompt([
    {
      name: "contractName",
      message: "contract name",
      type: "input",
    },
    {
      name: "contractAddress",
      message: "contract address",
      type: "input",
    },
    {
      name: "owner",
      message: "owner",
      type: "input",
    },
  ])

  const contract = await ethers.getContractAt(answers.contractName, answers.contractAddress)

  const tx = await contract.transferOwnership(answers.owner)
  const receipt = await tx.wait()
  console.log("Done with tx", receipt.transactionHash)
}

transferOwnership().catch((error) => console.error(error))
