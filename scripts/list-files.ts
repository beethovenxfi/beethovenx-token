import fs from "fs"
import path from "path"

export const getSolidityFileNames = (directory: string): string[] => {
  const filesInDirectory = fs.readdirSync(directory)
  const files = []
  for (const file of filesInDirectory) {
    const absolute = path.join(directory, file)
    if (fs.statSync(absolute).isDirectory()) {
      files.push(...getSolidityFileNames(absolute))
    } else {
      if (file.endsWith(".sol")) {
        files.push(file.replace(".sol", ""))
      }
    }
  }
  return files
}
