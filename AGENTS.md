# ambuflow — agent instructions

## Pinned versions — target these exactly

This project is on **Expo SDK 52**. Do not write code for a newer SDK.

| Package | Version |
| --- | --- |
| expo | ~52.0.0 (52.0.49 installed) |
| react | 18.3.1 |
| react-native | 0.76.7 |
| typescript | ^5.3.3 (strict mode) |

Versioned docs: **https://docs.expo.dev/versions/v52.0.0/**

Metro is pinned to 0.82.5 via `overrides` in package.json — leave that alone.

## Commands

```
npx expo start --localhost --android   # run on a USB-connected Android phone
npx tsc --noEmit                       # typecheck — must be zero errors
```

`tsx` is not installed. To run a script under `scripts/`, see the comment at the top
of that file.

## Project design decisions

Read **[DETAILS.md](./DETAILS.md)** before writing any feature code. It holds the
product overview, runtime constraints, and the locked design decisions — do not
change those without asking.
