echo "Flattening all contracts (if this fails, disable circular dependency check in balancer-v2-monorepo/node_modules/hardhat/builtin-tasks/flatten.js, refer to comment in the bash script)..."

rm -rf ./contracts
mkdir ./contracts

#yarn hardhat flatten ./_contracts/BeethovenxToken.sol > ./contracts/BeethovenxToken.sol
yarn hardhat flatten ./_contracts/BeethovenxMasterChef.sol > ./contracts/BeethovenxMasterChef.sol
yarn hardhat flatten ./_contracts/BeethovenxBar.sol > ./contracts/BeethovenxBar.sol


echo "Removing extra SPDX licenses and experimental ABIEncoderV2 lines..."
node ./scripts/clean-up-flattened-files.js

#echo "Compiling contracts..."
#yarn hardhat compile


# Updated get sorted files function for flatten.js that disables the circular dependency check
#function getSortedFiles(dependenciesGraph) {
#    const tsort = require("tsort");
#    const graph = tsort();
#    const filesMap = {};
#    const resolvedFiles = dependenciesGraph.getResolvedFiles();
#    resolvedFiles.forEach((f) => (filesMap[f.sourceName] = f));
#    const cycles = [];
#    for (const [from, deps] of dependenciesGraph.entries()) {
#        for (const to of deps) {
#            if (!cycles.includes(`${to.sourceName} ${from.sourceName}`)) {
#                graph.add(to.sourceName, from.sourceName);
#            }
#
#            cycles.push(`${from.sourceName} ${to.sourceName}`);
#        }
#    }
#    try {
#        const topologicalSortedNames = graph.sort();
#        // If an entry has no dependency it won't be included in the graph, so we
#        // add them and then dedup the array
#        const withEntries = topologicalSortedNames.concat(resolvedFiles.map((f) => f.sourceName));
#        const sortedNames = [...new Set(withEntries)];
#        return sortedNames.map((n) => filesMap[n]);
#    }
#    catch (error) {
#        console.log('throwing error');
#        if (error.toString().includes("Error: There is a cycle in the graph.")) {
#            throw new errors_1.HardhatError(errors_list_1.ERRORS.BUILTIN_TASKS.FLATTEN_CYCLE, error);
#        }
#        // tslint:disable-next-line only-hardhat-error
#        throw error;
#    }
#}