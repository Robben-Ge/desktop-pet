function getCursorProbeDispatch(point, lastProbe) {
  const key = point?.inside ? "inside" : "outside";
  return {
    key,
    // A stationary pointer still needs fresh hit testing while CSS transforms
    // move the pet. Repeated outside probes carry no new information.
    shouldSend: key === "inside" || key !== lastProbe
  };
}

module.exports = { getCursorProbeDispatch };
