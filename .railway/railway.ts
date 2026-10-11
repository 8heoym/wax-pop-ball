import { defineRailway, github, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "web";
export default defineRailway(() => {
  const web = service("web", {
    // main에 push하면 자동 배포. checkSuites: GitHub Actions(테스트)가 통과한 커밋만 배포
    source: github("8heoym/wax-pop-ball", { branch: "main", checkSuites: true }),
    // builder from CaC: "RAILPACK"
    build: "npm run build",
    start: "npm start",
    healthcheck: "/",
    replicas: { "asia-southeast1-eqsg3a": 1 },
  });

  return project("wax-pop-ball", {
    variables: { managed: false },
    resources: [web],
  });
});
