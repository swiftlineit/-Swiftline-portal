import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildAlsCreateDocketPayload,
  sanitizeAlsRequestSnapshot
} from "../services/alsPayloadMapper.service.js";
import {
  DpdApiError,
  DpdTimeoutError,
  createDpdShipment,
  parseAlsCreateDocketResponse,
  readCarrierErrors,
  resetAlsAuthCacheForTests
} from "../services/dpdApiClient.service.js";
import { isCompleteDpdLabelSet } from "../services/dpdShipment.service.js";
import type { DpdProviderConfiguration } from "../services/dpdProviderConfiguration.service.js";

const configuration: DpdProviderConfiguration = {
  mode: "LIVE",
  active: true,
  apiBaseUrl: "https://als.example.test",
  businessUnitCode: "ALS",
  customerId: "ALS-AUTH",
  senderAddressId: "ALS-CONSIGNOR",
  depotCode: "",
  defaultServiceCode: "DPD_CLASSIC",
  defaultLabelSize: "A6",
  defaultPrintFormat: "PDF",
  als: {
    companyId: 178,
    email: "api@example.test",
    password: "not-a-real-password",
    serviceCode: "DPD UK NEXTDAY",
    inrPerGbp: 120
  },
  credentials: {}
};

function draft() {
  return {
    consignorAddress: {
      companyName: "Example India Exporter",
      contactName: "Test Shipper",
      email: "shipper@example.test",
      mobileCountryCode: "+91",
      mobileNumber: "9000000000",
      aadhaarNumber: "111122223333",
      countryCode: "IN",
      postcode: "110001",
      addressLine1: "1 Test Road",
      addressLine2: "Test Area",
      townOrCity: "New Delhi",
      county: "Delhi"
    },
    consigneeEnteredAddress: {
      companyName: "Example UK Receiver",
      contactName: "Test Receiver",
      email: "receiver@example.test",
      mobileCountryCode: "+44",
      mobileNumber: "7700900000",
      countryCode: "GB",
      postcode: "SW1A 2AA",
      addressLine1: "10 Test Street",
      addressLine2: "Westminster",
      townOrCity: "London",
      county: "Greater London"
    },
    consigneeValidatedAddress: null,
    parcelList: [
      {
        sequence: 1,
        weightKg: 7,
        lengthCm: 30,
        widthCm: 20,
        heightCm: 10,
        contentsDescription: "Clothing",
        items: [{ description: "Clothing", hsnCode: "62034200", unitType: "Pcs", quantity: 2, unitRate: 6_000 }]
      },
      {
        sequence: 2,
        weightKg: 11,
        lengthCm: 40,
        widthCm: 30,
        heightCm: 20,
        contentsDescription: "Shoes",
        items: [{ description: "Shoes", hsnCode: "64039900", unitType: "Pair", quantity: 3, unitRate: 12_000 }]
      }
    ]
  };
}

function buildPayload(source = draft()) {
  return buildAlsCreateDocketPayload({
    draft: source as never,
    configuration,
    customerId: 18,
    trackingNumber: "SLCDEL110826001",
    bookedAt: new Date("2026-08-11T06:30:00.000Z")
  });
}

describe("ALS create_docket request mapping", () => {
  test("maps two portal parcels to one GBP ALS booking carrying the customs invoice", () => {
    const payload = buildPayload();

    assert.equal(payload.api_service_code, "DPD UK NEXTDAY");
    assert.equal(payload.pcs, "2");
    assert.equal(payload.actual_weight, "18.00");
    assert.equal(payload.shipment_value_currency, "GBP");
    assert.equal(payload.shipment_value, "400.00");
    assert.equal(payload.shipment_invoice_no, "SLCDEL110826001");
    assert.deepEqual(payload.docket_items, [
      { actual_weight: "7.00", length: "30.00", width: "20.00", height: "10.00", number_of_boxes: "1" },
      { actual_weight: "11.00", length: "40.00", width: "30.00", height: "20.00", number_of_boxes: "1" }
    ]);

    const snapshot = sanitizeAlsRequestSnapshot(payload);
    assert.equal(snapshot.shipper_contact_no, "[redacted-phone]");
    assert.equal(snapshot.shipper_gstin_no, "[redacted-id]");
    assert.equal(snapshot.consignee_email, "[redacted-email]");
  });

  // Sending "0" with no line items is what produced the production rejection
  // "SHIPMENT INVOICE are mandatory".
  test("declares the customs invoice ALS requires for a NONDOX shipment", () => {
    const payload = buildPayload();

    assert.equal(payload.new_docket_free_form_invoice, "1");
    assert.equal(payload.free_form_invoice_type_id, "1");
    assert.equal(payload.free_form_currency, "GBP");
    assert.equal(payload.terms_of_trade, "CFR");
    assert.deepEqual(payload.free_form_line_items, [
      {
        total: "100.00", no_of_packages: "2", box_no: "1", rate: "50.00",
        hscode: "62034200", description: "Clothing", unit_of_measurement: "Pcs",
        unit_weight: "7.00", igst_amount: "0.00"
      },
      {
        total: "300.00", no_of_packages: "3", box_no: "2", rate: "100.00",
        hscode: "64039900", description: "Shoes", unit_of_measurement: "Pair",
        unit_weight: "11.00", igst_amount: "0.00"
      }
    ]);
  });

  test("keeps the declared value reconciled against the sum of its invoice lines", () => {
    // 128 INR/GBP is the production rate and divides unevenly, so an independent
    // conversion of the total would drift from the lines by a rounding cent.
    const payload = buildAlsCreateDocketPayload({
      draft: draft() as never,
      configuration: { ...configuration, als: { ...configuration.als, inrPerGbp: 128 } },
      customerId: 18,
      trackingNumber: "SLCDEL110826001",
      bookedAt: new Date("2026-08-11T06:30:00.000Z")
    });

    const lineTotal = payload.free_form_line_items
      .reduce((sum, item) => sum + Number(item.total), 0);
    assert.equal(payload.shipment_value, lineTotal.toFixed(2));
    // Each line's total must equal rate x quantity, as ALS defines it.
    for (const item of payload.free_form_line_items) {
      assert.equal(Number(item.total).toFixed(2), (Number(item.rate) * Number(item.no_of_packages)).toFixed(2));
    }
  });

  test("splits a parcel's weight across its goods lines without losing grams", () => {
    const source = draft();
    source.parcelList = [{
      sequence: 1,
      weightKg: 1,
      lengthCm: 22,
      widthCm: 12,
      heightCm: 18,
      contentsDescription: "RAKHI, CHOCOLATE",
      items: [
        { description: "RAKHI", hsnCode: "95059090", unitType: "Pkt", quantity: 1, unitRate: 500 },
        { description: "CHOCOLATE", hsnCode: "1806", unitType: "Pkt", quantity: 1, unitRate: 800 }
      ]
    }] as never;

    const payload = buildPayload(source);
    const weights = payload.free_form_line_items.map((item) => Number(item.unit_weight));

    assert.equal(payload.free_form_line_items.length, 2);
    assert.equal(weights.reduce((sum, weight) => sum + weight, 0), 1);
    assert.deepEqual(payload.free_form_line_items.map((item) => item.box_no), ["1", "1"]);
    // A four digit HS code is carried through untouched: padding it would
    // falsify the declaration.
    assert.equal(payload.free_form_line_items[1]?.hscode, "1806");
  });

  test("refuses to book goods that cannot be declared", () => {
    const missingHsCode = draft();
    missingHsCode.parcelList[0]!.items = [
      { description: "Clothing", hsnCode: "", unitType: "Pcs", quantity: 2, unitRate: 6_000 }
    ];
    assert.throws(() => buildPayload(missingHsCode), /needs an HS code/);

    const missingValue = draft();
    missingValue.parcelList[0]!.items = [
      { description: "Clothing", hsnCode: "62034200", unitType: "Pcs", quantity: 0, unitRate: 6_000 }
    ];
    assert.throws(() => buildPayload(missingValue), /needs a quantity and unit value/);
  });
});

describe("ALS combined HTML label response", () => {
  test("keeps five parcel numbers and stores one protected five-page HTML document", () => {
    const pages = Array.from({ length: 5 }, (_, index) => (
      `<div style='page-break-after: always'><span>Packages</span><span>${index + 1} of 5</span></div>`
    )).join("");
    const parsed = parseAlsCreateDocketResponse({
      success: true,
      errors: [],
      data: {
        docket_id: 27681,
        awb_no: "AWB-TEST-1001",
        forwording_no: "FORWARD-TEST-1001",
        entry_number: "ENTRY-TEST-1001"
      },
      labels: [{ label: pages, file_type: "text/html", filename: "labels.html" }],
      parcels: Array.from({ length: 5 }, (_, index) => ({
        parcel_no: `PARCEL-TEST-${index + 1}`,
        box_no: String(index + 1)
      }))
    }, { tracking_no: "SLCDEL110826001" });

    assert.equal(parsed.dpdShipmentId, "AWB-TEST-1001");
    assert.equal(parsed.dpdTransactionId, "27681");
    assert.equal(parsed.forwardingNumber, "FORWARD-TEST-1001");
    assert.equal(parsed.entryNumber, "ENTRY-TEST-1001");
    assert.deepEqual(parsed.parcelNumbers, [
      "PARCEL-TEST-1",
      "PARCEL-TEST-2",
      "PARCEL-TEST-3",
      "PARCEL-TEST-4",
      "PARCEL-TEST-5"
    ]);
    assert.equal(parsed.labels.length, 1);
    assert.equal(parsed.labels[0]?.format, "HTML");
    assert.equal(parsed.labels[0]?.parcelNumber, "AWB-TEST-1001");
    const html = parsed.labels[0]?.content.toString("utf8") ?? "";
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /1 of 5/);
    assert.match(html, /5 of 5/);
    assert.equal((parsed.rawResponse.labels as Array<{ content: string }>)[0]?.content, "[stored-separately]");
  });
});

describe("ALS create_docket response parsing", () => {
  // Captured verbatim from the booking ALS accepted in production on
  // 2026-08-10 (AWB 1017351262). `labels` and `parcels` sit at the top level,
  // not under `data`.
  const productionResponse = {
    success: true,
    errors: [],
    data: {
      docket_id: 27681,
      awb_no: "1017351262",
      forwording_no: "3923987761",
      entry_number: "1017351262",
      remote_area_charges: ""
    },
    labels: [{
      label: "<div style='page-break-after: always'><span>Packages</span><span>1 of 1</span></div>",
      file_type: "text/html",
      filename: "20260810183308_1618_dpd_label_1392398776121407.html"
    }],
    parcels: [{
      parcel_no: "15503923987761",
      box_no: "1",
      actual_wt: "21.00",
      item_length: "10.00",
      item_width: "10.00",
      item_height: "10.00",
      volumetric_wt: "0.00",
      chargeable_wt: "21.00"
    }],
    "Response Code": 200
  };

  test("reads the shipment, parcel and label out of a real accepted booking", () => {
    const parsed = parseAlsCreateDocketResponse(productionResponse, { tracking_no: "SWIFTREAL001" });

    assert.equal(parsed.dpdShipmentId, "1017351262");
    assert.equal(parsed.dpdTransactionId, "27681");
    assert.equal(parsed.forwardingNumber, "3923987761");
    assert.equal(parsed.entryNumber, "1017351262");
    assert.deepEqual(parsed.parcelNumbers, ["15503923987761"]);
    assert.equal(parsed.labels.length, 1);
    assert.equal(parsed.labels[0]?.format, "HTML");
    // A single label covers the whole consignment, so it is filed under the AWB.
    assert.equal(parsed.labels[0]?.parcelNumber, "1017351262");
  });

  test("files one label per parcel when the carrier returns them that way", () => {
    const parsed = parseAlsCreateDocketResponse({
      success: true,
      errors: [],
      data: { docket_id: 1, awb_no: "AWB-2", entry_number: "AWB-2" },
      labels: [
        { label: "<div>box 1</div>", file_type: "text/html" },
        { label: "<div>box 2</div>", file_type: "text/html" }
      ],
      parcels: [{ parcel_no: "P-1" }, { parcel_no: "P-2" }]
    }, {});

    assert.deepEqual(parsed.labels.map((label) => label.parcelNumber), ["P-1", "P-2"]);
  });

  test("surfaces the carrier's own rejection text for operations", () => {
    assert.deepEqual(readCarrierErrors({ errors: ["SHIPMENT INVOICE are mandatory"] }), [
      "SHIPMENT INVOICE are mandatory"
    ]);
    assert.deepEqual(readCarrierErrors({ errors: "Freight amount is 0" }), ["Freight amount is 0"]);
    assert.deepEqual(readCarrierErrors({}), []);
  });
});

describe("carrier label set completeness", () => {
  // Getting this wrong strands a live booking in reconciliation with the
  // customer's money still reserved, so both shapes ALS may return are accepted.
  test("accepts a live booking as one combined document or one label per parcel", () => {
    const live = (parcelCount: number, labelCount: number) => isCompleteDpdLabelSet({
      bookingProvider: "DPD", providerMode: "LIVE", parcelCount, labelCount
    });

    assert.equal(live(1, 1), true);
    assert.equal(live(3, 1), true);
    assert.equal(live(3, 3), true);
    assert.equal(live(3, 2), false);
    assert.equal(live(3, 0), false);
  });

  test("requires one rendered label per parcel in simulated mode", () => {
    const simulated = (parcelCount: number, labelCount: number) => isCompleteDpdLabelSet({
      bookingProvider: "DPD", providerMode: "SIMULATED", parcelCount, labelCount
    });

    assert.equal(simulated(2, 2), true);
    assert.equal(simulated(2, 1), false);
  });

  test("expects no carrier label for an internal Swiftline shipment", () => {
    assert.equal(isCompleteDpdLabelSet({
      bookingProvider: "SWIFTLINE", providerMode: "LIVE", parcelCount: 2, labelCount: 0
    }), true);
    assert.equal(isCompleteDpdLabelSet({
      bookingProvider: "SWIFTLINE", providerMode: "LIVE", parcelCount: 2, labelCount: 1
    }), false);
  });
});

describe("ALS booking retry safety", () => {
  test("refreshes once only after an explicit token-expired rejection", async () => {
    const originalFetch = globalThis.fetch;
    resetAlsAuthCacheForTests();
    const calls: string[] = [];
    let authenticationCount = 0;

    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/docket_api/get_token")) {
        authenticationCount += 1;
        return new Response(JSON.stringify({
          success: true,
          data: { token: `TOKEN-${authenticationCount}`, customer_id: "18" },
          errors: []
        }), { status: 200 });
      }
      if (calls.filter((call) => call.endsWith("/docket_api/create_docket")).length === 1) {
        return new Response(JSON.stringify({ success: false, errors: ["AUTH TOKEN EXPIRED. PLEASE GENERATE NEW AUTH TOKEN"] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        success: true,
        data: { docket_id: 1, awb_no: "AWB-RETRY-TEST", entry_number: "AWB-RETRY-TEST" },
        labels: [{ label: "<div>1 of 2</div><div>2 of 2</div>", file_type: "text/html" }],
        parcels: [{ parcel_no: "P-1" }, { parcel_no: "P-2" }],
        errors: []
      }), { status: 200 });
    };

    try {
      const response = await createDpdShipment(
        configuration,
        draft() as never,
        "SLCDEL110826002",
        new Date("2026-08-11T06:30:00.000Z")
      );
      assert.equal(response.dpdShipmentId, "AWB-RETRY-TEST");
      assert.equal(calls.filter((call) => call.endsWith("/docket_api/get_token")).length, 2);
      assert.equal(calls.filter((call) => call.endsWith("/docket_api/create_docket")).length, 2);
    } finally {
      globalThis.fetch = originalFetch;
      resetAlsAuthCacheForTests();
    }
  });

  // ALS returned exactly this on 2026-08-13, with HTTP 500, once the customs
  // invoice was accepted and the booking reached its account balance.
  test("reports a carrier refusal as a conflict, not as a Swiftline server error", async () => {
    const originalFetch = globalThis.fetch;
    resetAlsAuthCacheForTests();

    globalThis.fetch = async (input) => {
      if (String(input).endsWith("/docket_api/get_token")) {
        return new Response(JSON.stringify({
          success: true, data: { token: "TOKEN", customer_id: "18" }, errors: []
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        success: false,
        errors: ["Customer credit limit is reached"],
        "Response Code": 500
      }), { status: 500 });
    };

    try {
      await createDpdShipment(
        configuration,
        draft() as never,
        "SLCDEL110826004",
        new Date("2026-08-11T06:30:00.000Z")
      );
      assert.fail("expected the booking to be refused");
    } catch (error) {
      assert.ok(error instanceof DpdApiError);
      // Not 500: the carrier understood the shipment and declined it.
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /credit limit/i);
      // The generic "check your shipment information" wording would have sent
      // Operations looking for a bad field instead of an unpaid account.
      assert.doesNotMatch(error.message, /carrier-required shipment information/);
      assert.deepEqual(readCarrierErrors(error.providerResponse), ["Customer credit limit is reached"]);
    } finally {
      globalThis.fetch = originalFetch;
      resetAlsAuthCacheForTests();
    }
  });

  test("does not retry create_docket after an uncertain network failure", async () => {
    const originalFetch = globalThis.fetch;
    resetAlsAuthCacheForTests();
    let createAttempts = 0;

    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/docket_api/get_token")) {
        return new Response(JSON.stringify({
          success: true,
          data: { token: "TOKEN", customer_id: "18" },
          errors: []
        }), { status: 200 });
      }
      createAttempts += 1;
      throw new TypeError("simulated connection loss");
    };

    try {
      await assert.rejects(
        createDpdShipment(
          configuration,
          draft() as never,
          "SLCDEL110826003",
          new Date("2026-08-11T06:30:00.000Z")
        ),
        DpdTimeoutError
      );
      assert.equal(createAttempts, 1);
    } finally {
      globalThis.fetch = originalFetch;
      resetAlsAuthCacheForTests();
    }
  });
});
