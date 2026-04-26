import fs from "node:fs"
import path from "node:path"

const MEMORY_DIR = ".memory"

function memoryPath(userId: string) {
  return path.join(MEMORY_DIR, `${userId}.md`)
}

export function readMemory(userId: string): string {
  const file = memoryPath(userId)
  if (!fs.existsSync(file)) return ""
  return fs.readFileSync(file, "utf8")
}

export function writeMemory(userId: string, content: string) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true })
  fs.writeFileSync(memoryPath(userId), content)
}

export function clearMemory(userId: string) {
  const file = memoryPath(userId)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}
