const hre = require("hardhat");

async function main() {
  const JobManager = await hre.ethers.getContractFactory("JobManager");
  const jobManager = await JobManager.deploy();

  console.log("Deploy transaction hash:", jobManager.deploymentTransaction().hash);

  await jobManager.waitForDeployment(); // Ждём подтверждения

  console.log("JobManager deployed to:", jobManager.target);
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});
