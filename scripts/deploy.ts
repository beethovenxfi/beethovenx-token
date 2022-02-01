import inquirer from "inquirer"
import { ethers, run } from "hardhat"
import fs from "fs"
import path from "path"
import { getSolidityFileNames } from "./list-files"

const network = process.env.HARDHAT_NETWORK!
const contractPath = process.env.CONTRACT_PATH || path.join(process.cwd(), "contracts")

async function deployAndVerify() {
  const contracts = getSolidityFileNames(contractPath)
  const answers = await inquirer.prompt([
    {
      name: "contractName",
      message: "contract name:",
      type: "list",
      choices: contracts,
    },
    {
      name: "args",
      message: "Comma seperated args:",
      type: "input",
    },
    {
      name: "id",
      message: "Deployment ID",
      type: "input",
    },
  ])

  const { contractName, args, id } = answers
  const argsList = args.length > 0 ? args.split(",") : []

  const baseDir = path.join(process.cwd(), "on_chain", network)
  const fileName = `${id}.json`

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true })
  }

  if (fs.existsSync(path.join(baseDir, fileName))) {
    const overwrite = await inquirer.prompt([
      {
        name: "confirm",
        message: `Deployment with ID ${id} already exists, overwrite?`,
        type: "confirm",
      },
    ])
    if (!overwrite.confirm) {
      return
    }
  }
  console.log(`Deploying contract ${contractName} with args [${args}]`)

  const contract = await ethers.getContractFactory(contractName)
  const deployment = await contract.deploy(...argsList)
  await deployment.deployed()

  console.log(`Contract deployed at ${deployment.address} with tx ${deployment.deployTransaction.hash}.`)

  const verifyAnswer = await inquirer.prompt([
    {
      name: "confirm",
      message: "Verify contract (wait a bit)",
      type: "confirm",
    },
  ])

  const report = {
    contract: contractName,
    address: deployment.address,
    args: argsList,
    verified: false,
  }

  if (verifyAnswer.confirm) {
    try {
      await run("verify:verify", {
        address: deployment.address,
        constructorArguments: argsList,
      })
      report.verified = true
    } catch (error) {
      console.error("Error verifying contract", error)
    }
  }
  fs.writeFileSync(path.join(baseDir, fileName), JSON.stringify(report))
}

deployAndVerify().catch((error) => console.error(error))
