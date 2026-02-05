import { Schema } from "effect"

const CugginoConfig = Schema.Struct({
  setupCommand: Schema.optionalKey(Schema.String),
  checkCommand: Schema.optionalKey(Schema.String),
  specsPath: Schema.String.pipe(Schema.withDecodingDefaultKey(() => ".specs"))
})

const encodeCugginoConfig = Schema.encodeSync(Schema.fromJsonString(CugginoConfig))

// Test 1: Both undefined
console.log("Test 1: Both setupCommand and checkCommand are undefined")
const config1 = {
  setupCommand: undefined,
  checkCommand: undefined,
  specsPath: ".specs"
}
try {
  const result = encodeCugginoConfig(config1)
  console.log("Result:", result)
  console.log("Parsed:", JSON.parse(result))
} catch (e) {
  console.error("Error:", (e as Error).message)
}

// Test 2: One undefined
console.log("\nTest 2: setupCommand is undefined, checkCommand has value")
const config2 = {
  setupCommand: undefined,
  checkCommand: "npm test",
  specsPath: ".specs"
}
try {
  const result = encodeCugginoConfig(config2)
  console.log("Result:", result)
  console.log("Parsed:", JSON.parse(result))
} catch (e) {
  console.error("Error:", (e as Error).message)
}

// Test 3: Neither undefined
console.log("\nTest 3: Both have values")
const config3 = {
  setupCommand: "npm install",
  checkCommand: "npm test",
  specsPath: ".specs"
}
try {
  const result = encodeCugginoConfig(config3)
  console.log("Result:", result)
  console.log("Parsed:", JSON.parse(result))
} catch (e) {
  console.error("Error:", (e as Error).message)
}

// Test 4: Missing keys entirely
console.log("\nTest 4: Both keys are missing")
const config4 = {
  specsPath: ".specs"
}
try {
  const result = encodeCugginoConfig(config4)
  console.log("Result:", result)
  console.log("Parsed:", JSON.parse(result))
} catch (e) {
  console.error("Error:", (e as Error).message)
}
