import { network } from "hardhat"
import { ContractTransaction } from "@ethersproject/contracts"

const { ethers } = require("hardhat")

const { BigNumber } = ethers

export async function advanceBlock() {
  return ethers.provider.send("evm_mine", [])
}

export async function advanceBlockTo(blockNumber: string) {
  for (let i = await ethers.provider.getBlockNumber(); i < blockNumber; i++) {
    await advanceBlock()
  }
}

export async function advanceBlockRelativeTo(tx: ContractTransaction, amountOfBlocks: number) {
  const blockNumber = tx.blockNumber! + amountOfBlocks
  for (let i = await ethers.provider.getBlockNumber(); i < blockNumber; i++) {
    await advanceBlock()
  }
}

export async function setAutomineBlocks(enabled: boolean) {
  return network.provider.send("evm_setAutomine", [enabled])
}

export async function increase(value: number) {
  await ethers.provider.send("evm_increaseTime", [value])
  await advanceBlock()
}

export async function latest() {
  const block = await ethers.provider.getBlock("latest")
  return BigNumber.from(block.timestamp)
}

export async function advanceTimeAndBlock(time: number) {
  await advanceTime(time)
  await advanceBlock()
}

export async function advanceTime(time: number) {
  await ethers.provider.send("evm_increaseTime", [time])
}

export const duration = {
  seconds: function (val: string) {
    return BigNumber.from(val)
  },
  minutes: function (val: string) {
    return BigNumber.from(val).mul(this.seconds("60"))
  },
  hours: function (val: string) {
    return BigNumber.from(val).mul(this.minutes("60"))
  },
  days: function (val: string) {
    return BigNumber.from(val).mul(this.hours("24"))
  },
  weeks: function (val: string) {
    return BigNumber.from(val).mul(this.days("7"))
  },
  years: function (val: string) {
    return BigNumber.from(val).mul(this.days("365"))
  },
}
