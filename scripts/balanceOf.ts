import inquirer from "inquirer"
import { ethers } from "hardhat"
import { bn } from "../test/utilities"

async function balanceOf() {
  const answers = await inquirer.prompt([
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

  const contract = await ethers.getContractAt("ERC20", answers.contractAddress)

  const result = await contract.balanceOf(answers.owner)
  console.log(ethers.utils.formatUnits(result))
}

balanceOf().catch((error) => console.error(error))
