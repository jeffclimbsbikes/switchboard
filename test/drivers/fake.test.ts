import { FakeDriver } from "../../src/drivers/fake.js";
import { runDriverContract } from "../contract/driver-contract.js";

runDriverContract("fake", async () => ({ driver: new FakeDriver(), cwd: process.cwd() }));
