# Development

## Local environment

```sh
npx hardhat node
```

## Testing

```sh
yarn test
```

### Single files

```sh
yarn test test/MasterChef.test.js
```

Mocha & Chai with Waffle matchers (these are really useful).

<https://ethereum-waffle.readthedocs.io/en/latest/matchers.html>

## Seeding

npx hardhat run --network localhost scripts/seed.js

## Console

```sh
yarn console

npx hardhat --network localhost console
```

<https://hardhat.org/guides/hardhat-console.html>

## Coverage

```sh
yarn test:coverage
```

<https://hardhat.org/plugins/solidity-coverage.html#tasks>

## Gas Usage

```sh
yarn test:gas
```

<https://github.com/cgewecke/hardhat-gas-reporter>

## Lint

```sh
yarn lint
```

## Watch

```sh
npx hardhat watch compile
```
