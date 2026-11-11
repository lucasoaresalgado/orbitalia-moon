/** A problem retrying won't fix (a missing credential or connection): fail at once and say why. */
export class ConfigError extends Error {}

/** The card was deleted by Lucas: pipeline steps for it stop quietly. */
export class CardDeleted extends Error {}
