import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("checkout rule deletion", () => {
  const controller = readFileSync(join(__dirname, "management.controller.ts"), "utf8");
  const service = readFileSync(join(__dirname, "management.service.ts"), "utf8");

  it("exposes location-scoped permanent deletion for taxes and service charges", () => {
    expect(controller).toContain('@Delete("settings/tax-rules/:ruleId")');
    expect(controller).toContain('@Delete("settings/service-charge-rules/:ruleId")');
    expect(service).toContain("async deleteTaxRule");
    expect(service).toContain("async deleteServiceCharge");
    expect(service).toContain('action: "tax_rule.deleted"');
    expect(service).toContain('action: "service_charge_rule.deleted"');
    expect(service.match(/where: \{ id: input\.ruleId, locationId: input\.locationId \}/g)).toHaveLength(4);
  });
});
