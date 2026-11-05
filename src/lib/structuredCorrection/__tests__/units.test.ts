import { describe, expect, it } from "vitest";
import {
  checkUnit,
  convertToUnit,
  parseUnit,
  sameDimension,
  splitQuantity,
  toBase,
  unitsEquivalent,
} from "@/lib/structuredCorrection/units";

describe("parseUnit", () => {
  it.each(["m", "kg", "mg", "mL", "cm", "km/h", "m/s", "m/s^2", "m/s²", "kg m/s", "kg·m/s", "J/(kg K)", "N/m²", "m s^-1", "m s⁻¹", "µF", "kPa", "MPa", "°C", "ohm", "Ω", "min", "eV", "mol"])(
    "recognises %s",
    (unit) => {
      expect(parseUnit(unit), unit).not.toBeNull();
    },
  );

  it.each(["", "foo", "apples/day", "furlong", "m//s", "m/s^", "q", "kg^0", "x", "days", "5", "(m"])("does not recognise %j", (unit) => {
    expect(parseUnit(unit), unit).toBeNull();
  });

  it("reads min as a minute, never as milli-inches", () => {
    expect(toBase(2, parseUnit("min")!)).toBe(120);
  });

  it("reads mol as the mole, never as milli-ol", () => {
    expect(sameDimension(parseUnit("mol")!, parseUnit("mol")!)).toBe(true);
    expect(toBase(1, parseUnit("mmol")!)).toBeCloseTo(1e-3, 12);
  });
});

describe("conversion to base units", () => {
  it("converts mass", () => {
    expect(toBase(2000, parseUnit("mg")!)).toBeCloseTo(2e-3, 12); // kg
    expect(toBase(2, parseUnit("g")!)).toBeCloseTo(2e-3, 12);
  });

  it("converts volume: 250 mL = 0.25 L", () => {
    expect(toBase(250, parseUnit("mL")!)).toBeCloseTo(toBase(0.25, parseUnit("L")!), 12);
  });

  it("converts length and speed", () => {
    expect(toBase(36, parseUnit("km/h")!)).toBeCloseTo(10, 9);
    expect(toBase(5, parseUnit("cm")!)).toBeCloseTo(0.05, 12);
  });

  it("converts temperature scales that have an offset", () => {
    expect(toBase(0, parseUnit("°C")!)).toBeCloseTo(273.15, 9);
    expect(toBase(100, parseUnit("°C")!)).toBeCloseTo(373.15, 9);
    expect(toBase(32, parseUnit("°F")!)).toBeCloseTo(273.15, 6);
  });

  it("converts energy and charge", () => {
    expect(toBase(1, parseUnit("kJ")!)).toBeCloseTo(1000, 9);
    expect(toBase(5, parseUnit("µC")!)).toBeCloseTo(5e-6, 15);
  });
});

describe("unitsEquivalent", () => {
  it("accepts the same unit written differently", () => {
    expect(unitsEquivalent("N", "kg m/s^2")).toBe(true);
    expect(unitsEquivalent("J", "N m")).toBe(true);
    expect(unitsEquivalent("m/s²", "m/s^2")).toBe(true);
    expect(unitsEquivalent("Ω", "ohm")).toBe(true);
    expect(unitsEquivalent("L", "l")).toBe(true);
    expect(unitsEquivalent("W", "J/s")).toBe(true);
  });

  it("does not accept the same quantity in another prefix, or another quantity", () => {
    expect(unitsEquivalent("g", "mg")).toBe(false);
    expect(unitsEquivalent("m", "cm")).toBe(false);
    expect(unitsEquivalent("N", "J")).toBe(false);
    expect(unitsEquivalent("m/s", "m/s^2")).toBe(false);
  });

  it("is false when either side is not a recognised unit", () => {
    expect(unitsEquivalent("furlong", "m")).toBe(false);
    expect(unitsEquivalent("m", "")).toBe(false);
  });
});

describe("convertToUnit", () => {
  it("2000 mg is 2 g (a correct answer in another unit)", () => {
    expect(convertToUnit(2000, parseUnit("mg")!, parseUnit("g")!)).toBeCloseTo(2, 9);
  });

  it("2000 g is 2000 g, not 2 g (a wrong answer stays wrong)", () => {
    expect(convertToUnit(2000, parseUnit("g")!, parseUnit("g")!)).toBeCloseTo(2000, 9);
  });

  it("refuses to convert between different quantities", () => {
    expect(convertToUnit(5, parseUnit("m")!, parseUnit("s")!)).toBeNull();
  });
});

describe("splitQuantity", () => {
  it("splits a number from its unit", () => {
    expect(splitQuantity("2000 mg")).toMatchObject({ valueText: "2000", unitText: "mg" });
    expect(splitQuantity("4 m/s^2")).toMatchObject({ valueText: "4", unitText: "m/s^2" });
    expect(splitQuantity("3 x 10^8 m/s")).toMatchObject({ valueText: "3 x 10^8", unitText: "m/s" });
    expect(splitQuantity("37 °C")).toMatchObject({ valueText: "37", unitText: "°C" });
    expect(splitQuantity("10Ω")).toMatchObject({ valueText: "10", unitText: "Ω" });
  });

  it("uses only the part after the last equals sign", () => {
    expect(splitQuantity("a = (v - u)/t = (20 - 0)/5 = 4 m/s²")).toMatchObject({ valueText: "4", unitText: "m/s²" });
  });

  it("finds no unit in a bare number, a qualifier, or a word that is not a unit", () => {
    expect(splitQuantity("4").unitText).toBeNull();
    expect(splitQuantity("34.17 approximately").unitText).toBeNull();
    expect(splitQuantity("7 days").unitText).toBeNull();
    expect(splitQuantity("4x").unitText).toBeNull();
    expect(splitQuantity("5 apples/day").unitText).toBeNull();
  });
});

describe("checkUnit", () => {
  it("is a match when the written unit is equivalent", () => {
    expect(checkUnit("m/s^2", "4 m/s²")).toBe("match");
    expect(checkUnit("N", "10 kg m/s^2")).toBe("match");
    expect(checkUnit("J", "x = 120 J")).toBe("match");
  });

  it("is a mismatch for a recognised but different unit, including a different prefix", () => {
    expect(checkUnit("g", "2000 mg")).toBe("mismatch");
    expect(checkUnit("N", "10 J")).toBe("mismatch");
    expect(checkUnit("m/s", "5 m/s^2")).toBe("mismatch");
  });

  it("is absent when no unit follows the number", () => {
    expect(checkUnit("m/s", "20")).toBe("absent");
    expect(checkUnit("J", "120")).toBe("absent");
    expect(checkUnit("J", "34.17 approximately")).toBe("absent");
  });

  it("is unknown, never wrong, when a unit is not recognised", () => {
    expect(checkUnit("J", "5 furlongs")).toBe("unknown");
    expect(checkUnit("quatloo", "5 J")).toBe("unknown");
    expect(checkUnit(null, "5 J")).toBe("unknown");
    expect(checkUnit(undefined, "5 J")).toBe("unknown");
  });
});
