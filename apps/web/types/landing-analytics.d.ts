interface Window {
  ym?: (
    counterId: number,
    method: "init" | "reachGoal" | string,
    ...args: unknown[]
  ) => void;
}
