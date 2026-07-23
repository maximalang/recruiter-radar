export const LANDING_RADAR_SIGNAL_EVENT = "landing:radarsignal";

export type LandingRadarSignalDetail = {
  index: number;
};

export function dispatchLandingRadarSignal(index: number): void {
  window.dispatchEvent(
    new CustomEvent<LandingRadarSignalDetail>(LANDING_RADAR_SIGNAL_EVENT, {
      detail: { index },
    }),
  );
}
