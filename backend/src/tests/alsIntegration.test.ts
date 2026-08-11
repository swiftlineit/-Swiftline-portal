import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildAlsCreateDocketPayload,
  sanitizeAlsRequestSnapshot
} from "../services/alsPayloadMapper.service.js";
import {
  DpdTimeoutError,
  createDpdShipment,
  parseAlsCreateDocketResponse,
  resetAlsAuthCacheForTests
} from "../services/dpdApiClient.service.js";
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

describe("ALS create_docket request mapping", () => {
  test("maps two portal parcels to one GBP ALS booking without an ALS invoice", () => {
    const payload = buildAlsCreateDocketPayload({
      draft: draft() as never,
      invoiceUpload: {
        invoiceNumber: "INV-TEST-1001",
        uploadedAt: new Date("2026-08-11T06:30:00.000Z")
      } as never,
      configuration,
      customerId: 18,
      trackingNumber: "SLCDEL110826001",
      bookedAt: new Date("2026-08-11T06:30:00.000Z")
    });

    assert.equal(payload.api_service_code, "DPD UK NEXTDAY");
    assert.equal(payload.pcs, "2");
    assert.equal(payload.actual_weight, "18.00");
    assert.equal(payload.shipment_value_currency, "GBP");
    assert.equal(payload.shipment_value, "400.00");
    assert.equal(payload.shipment_invoice_no, "SLCDEL110826001");
    assert.equal(payload.new_docket_free_form_invoice, "0");
    assert.equal("free_form_line_items" in payload, false);
    assert.deepEqual(payload.docket_items, [
      { actual_weight: "7.00", length: "30.00", width: "20.00", height: "10.00", number_of_boxes: "1" },
      { actual_weight: "11.00", length: "40.00", width: "30.00", height: "20.00", number_of_boxes: "1" }
    ]);

    const snapshot = sanitizeAlsRequestSnapshot(payload);
    assert.equal(snapshot.shipper_contact_no, "[redacted-phone]");
    assert.equal(snapshot.shipper_gstin_no, "[redacted-id]");
    assert.equal(snapshot.consignee_email, "[redacted-email]");
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
        { invoiceNumber: "INV-RETRY", uploadedAt: new Date("2026-08-11T06:30:00.000Z") } as never,
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
          { invoiceNumber: "INV-NETWORK", uploadedAt: new Date("2026-08-11T06:30:00.000Z") } as never,
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
