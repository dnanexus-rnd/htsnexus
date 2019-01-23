"use strict";
const expect = require("expect.js");
const request = require("request");
const url = require("url");
const sqlite3 = require('sqlite3');
const Server = require("../src/server");

// GET the protocol response from the server started for local testing
function req(route, cb) {
    let rq = {
        url: "http://localhost:48444/v1" + route,
        headers: {origin: "https://www.dnanexus.com"}
    };
    request(rq, (error, response, body) => {
        if (error) {
            return cb(error);
        }
        expect(response.headers["content-type"]).to.match(/application\/vnd\.ga4gh\.htsget\..+\+json;?.*/);
        try {
            response.body = JSON.parse(body).htsget;
        } catch(e) {
            return cb(new Error("Invalid JSON response: " + body));
        }
        cb(null, response);
    });
}

describe("Server", function() {
    let server = null;
    before(function(_) {
        let db = new sqlite3.Database(__dirname + '/test.db');
        server = Server.Start({port: 48444, db: db}, _);
        server.on("response", (request) => {
            if (request.response.statusCode === 500) {
                console.dir(request.response.source);
            }
        });
    });

    describe("nonexistent route", function() {
        it("should return NotFound", function(_) {
            let res = req("/bogus", _);
            expect(res.statusCode).to.be(404);
            expect(res.body.error.type).to.be("NotFound");
        });
    });

    describe("GET reads", function() {
        it("should report NotFound for a nonexistent item", function(_) {
            let res = req("/reads/ENCODE/ENC123456", _);
            expect(res.statusCode).to.be(404);
            expect(res.body.error.type).to.be("NotFound");
        });

        it("should serve the URL for a BAM", function(_) {
            let res = req("/reads/ENCODE/ENCFF621SXE", _);
            expect(res.statusCode).to.be(200);
            expect(res.headers['access-control-allow-origin']).to.be('https://www.dnanexus.com');
            expect(res.body.urls.length).to.be(1);
            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].class).to.be(undefined);
            expect(res.body.format).to.be('BAM');

            // explicit format
            res = req("/reads/ENCODE/ENCFF621SXE?format=BAM", _);
            expect(res.statusCode).to.be(200);
            expect(res.headers['access-control-allow-origin']).to.be('https://www.dnanexus.com');
            expect(res.body.urls.length).to.be(1);
            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].class).to.be(undefined);
            expect(res.body.format).to.be('BAM');
        });

        it("should reject unspported formats", function(_) {
            let res = req("/reads/ENCODE/ENCFF621SXE?format=BOGUS", _);
            expect(res.statusCode).to.be(409);
            expect(res.body.error.type).to.be("UnsupportedFormat");
        });

        it("should serve the URL and byte range for a genomic range slice", function(_) {
            let res = req("/reads/htsnexus_test/NA12878?referenceName=20&start=6000000&end=6020000", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(3);
            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/http.*/);
            expect(res.body.urls[1].headers.range).to.be("bytes=977196-1165272");
            expect(res.body.urls[1].class).to.be("body");
            expect(res.body.reference).to.be('GRCh37');
            expect(res.body.format).to.be('BAM');

            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            let buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(res.body.urls[0].class).to.be("header");

            expect(res.body.urls[2].url).to.be.a('string');
            expect(res.body.urls[2].url).to.match(/data:.*/);
            buf = new Buffer(res.body.urls[2].url.substring(res.body.urls[2].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(buf.length).to.be(28);
            expect(res.body.urls[2].class).to.be("body");

            res = req("/reads/htsnexus_test/NA12878?format=BAM&referenceName=20&start=5000000&end=6020000", _);
            expect(res.body.urls.length).to.be(3);
            expect(res.body.urls[1].headers.range).to.be("bytes=977196-1165272");
        });

        it("should suppress BAM header slice prefix on request", function(_) {
            let res = req("/reads/htsnexus_test/NA12878?referenceName=20&start=6000000&end=6020000&class=body", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(2);
            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/http.*/);
            expect(res.body.urls[0].headers.range).to.be("bytes=977196-1165272");
            expect(res.body.format).to.be('BAM');
            expect(res.body.reference).to.be('GRCh37');
        });

        it("should provide BAM header-only on request", function(_) {
            let res = req("/reads/htsnexus_test/NA12878?referenceName=20&start=6000000&end=6020000&class=header", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(2);
            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            let buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(res.body.urls[0].class).to.be("header");
            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/data:.*/);
            expect(res.body.urls[1].class).to.be("body");
            buf = new Buffer(res.body.urls[1].url.substring(res.body.urls[1].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(buf.length).to.be(28);
        });

        it("should serve the byte range for a whole reference sequence", function(_) {
            let res = req("/reads/htsnexus_test/NA12878?referenceName=20", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(3);
            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/http.*/);
            expect(res.body.urls[1].headers.range).to.be("bytes=977196-2128165");
            expect(res.body.urls[1].class).to.be("body");
            expect(res.body.format).to.be('BAM');
            expect(res.body.reference).to.be('GRCh37');

            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            let buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(res.body.urls[0].class).to.be("header");

            expect(res.body.urls[2].url).to.be.a('string');
            expect(res.body.urls[2].url).to.match(/data:.*/);
            expect(res.body.urls[2].class).to.be("body");
            buf = new Buffer(res.body.urls[2].url.substring(res.body.urls[2].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(buf.length).to.be(28);
        });

        it("should serve the byte range for unmapped reads", function(_) {
            let res = req("/reads/htsnexus_test/NA12878?referenceName=*", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(3);
            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/http.*/);
            expect(res.body.urls[1].class).to.be("body");
            expect(res.body.urls[1].headers.range).to.be("bytes=2112141-2596770");
            expect(res.body.format).to.be('BAM');
            expect(res.body.reference).to.be('GRCh37');

            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            let buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(res.body.urls[0].class).to.be("header");

            expect(res.body.urls[2].url).to.be.a('string');
            expect(res.body.urls[2].url).to.match(/data:.*/);
            expect(res.body.urls[2].class).to.be("body");
            buf = new Buffer(res.body.urls[2].url.substring(res.body.urls[2].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(buf.length).to.be(28);
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(buf.length).to.be(28);
        });

        it("should serve empty result sets", function(_) {
            let res = req("/reads/htsnexus_test/NA12878?referenceName=20&start=1&end=10000", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.format).to.be('BAM');
            expect(res.body.urls.length).to.be(2);

            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            let buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(res.body.urls[0].class).to.be("header");

            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/data:.*/);
            buf = new Buffer(res.body.urls[1].url.substring(res.body.urls[1].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(buf.length).to.be(28);
            expect(res.body.urls[1].class).to.be("body");

            res = req("/reads/htsnexus_test/NA12878?referenceName=XXX", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(2);

            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(res.body.urls[0].class).to.be("header");

            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/data:.*/);
            buf = new Buffer(res.body.urls[1].url.substring(res.body.urls[1].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(buf.length).to.be(28);
            expect(res.body.urls[1].class).to.be("body");
        });

        it("should reject invalid ranges", function(_) {
            expect(req("/reads/htsnexus_test/NA12878?referenceName=20&start=XXX&end=2", _).statusCode).to.be(422);
            expect(req("/reads/htsnexus_test/NA12878?referenceName=20&start=2&end=1", _).statusCode).to.be(422);
        });

        it("should ignore range query for an unindexed BAM", function(_) {
            let res = req("/reads/ENCODE/ENCFF621SXE?referenceName=1", _);
            expect(res.statusCode).to.be(200);
            expect(res.headers['access-control-allow-origin']).to.be('https://www.dnanexus.com');
            expect(res.body.urls.length).to.be(1);
            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].class).to.be(undefined);
            expect(res.body.format).to.be('BAM');
        });

        it("should redirect to Heng Li's bamsvr", function(_) {
            let res = req("/reads/lh3bamsvr/EXA00001?format=BAM", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.format).to.be('BAM');
            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].headers).to.be(undefined);

            res = req("/reads/lh3bamsvr/EXA00001?referenceName=11:10899000&end=10900000", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.format).to.be('BAM');
            expect(res.body.prefix).to.be(undefined);
            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].headers).to.be(undefined);
            expect(res.body.suffix).to.be(undefined);
        });
    });

    describe("GET reads CRAM", function() {
        it("should serve the URL for a CRAM", function(_) {
            let res = req("/reads/htsnexus_test/NA12878?format=CRAM", _);
            expect(res.statusCode).to.be(200);
            expect(res.headers['access-control-allow-origin']).to.be('https://www.dnanexus.com');
            expect(res.body.urls.length).to.be(1);
            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/http.*/);
            expect(res.body.urls[0].class).to.be(undefined);
            expect(res.body.urls[0].headers.range).to.be("bytes=0-1661525");
            expect(res.body.format).to.be('CRAM');
        });

        it("should serve the URL and byte range for a genomic range slice", function(_) {
            let res = req("/reads/htsnexus_test/NA12878?format=CRAM&referenceName=20&start=6000000&end=6020000", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(3);
            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/http.*/);
            expect(res.body.urls[1].class).to.be("body");
            expect(res.body.urls[1].headers.range).to.be("bytes=617115-1094992");
            expect(res.body.format).to.be('CRAM');
            expect(res.body.reference).to.be('GRCh37');

            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            let buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf.slice(0,4).toString()).to.be('CRAM');
            expect(res.body.urls[0].class).to.be("header");

            expect(res.body.urls[2].url).to.be.a('string');
            expect(res.body.urls[2].url).to.match(/data:.*/);
            buf = new Buffer(res.body.urls[2].url.substring(res.body.urls[2].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x0f);
            expect(buf[1]).to.be(0x00);
            expect(buf.length).to.be(38);
            expect(res.body.urls[2].class).to.be("body");

            res = req("/reads/htsnexus_test/NA12878?format=CRAM&referenceName=20&start=5000000&end=6020000", _);
            expect(res.body.urls.length).to.be(3);
            expect(res.body.urls[1].headers.range).to.be("bytes=617115-1094992");
        });

        it("should suppress CRAM header slice prefix on request", function(_) {
            let res = req("/reads/htsnexus_test/NA12878?format=CRAM&referenceName=20&start=6000000&end=6020000&class=body", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(2);
            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/http.*/);
            expect(res.body.urls[0].headers.range).to.be("bytes=617115-1094992");
            expect(res.body.urls[0].class).to.be("body");
            expect(res.body.format).to.be('CRAM');
            expect(res.body.reference).to.be('GRCh37');
        });

        it("should provide CRAM header-only on request", function(_) {
            let res = req("/reads/htsnexus_test/NA12878?format=CRAM&referenceName=20&start=6000000&end=6020000&class=header", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(2);
            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            let buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf.slice(0,4).toString()).to.be('CRAM');
            expect(res.body.urls[0].class).to.be("header");
            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/data:.*/);
            expect(res.body.urls[1].class).to.be("body");
            buf = new Buffer(res.body.urls[1].url.substring(res.body.urls[1].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x0f);
            expect(buf[1]).to.be(0x00);
            expect(buf.length).to.be(38);
        });


        it("should serve the byte range for a whole reference sequence", function(_) {
            let res = req("/reads/htsnexus_test/NA12878?format=CRAM&referenceName=20", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(3);
            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/http.*/);
            expect(res.body.urls[1].class).to.be("body");
            expect(res.body.urls[1].headers.range).to.be("bytes=617115-1310236");
            expect(res.body.format).to.be('CRAM');
            expect(res.body.reference).to.be('GRCh37');

            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            let buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf.slice(0,4).toString()).to.be('CRAM');
            expect(res.body.urls[0].class).to.be("header");

            expect(res.body.urls[2].url).to.be.a('string');
            expect(res.body.urls[2].url).to.match(/data:.*/);
            buf = new Buffer(res.body.urls[2].url.substring(res.body.urls[2].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x0f);
            expect(buf[1]).to.be(0x00);
            expect(buf.length).to.be(38);
            expect(res.body.urls[2].class).to.be("body");
        });

        it("should serve the byte range for unmapped reads", function(_) {
            let res = req("/reads/htsnexus_test/NA12878?format=CRAM&referenceName=*", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(3);
            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/http.*/);
            expect(res.body.urls[1].class).to.be("body");
            expect(res.body.urls[1].headers.range).to.be("bytes=1310237-1661487");
            expect(res.body.format).to.be('CRAM');
            expect(res.body.reference).to.be('GRCh37');

            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            let buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf.slice(0,4).toString()).to.be('CRAM');
            expect(res.body.urls[0].class).to.be("header");

            expect(res.body.urls[2].url).to.be.a('string');
            expect(res.body.urls[2].url).to.match(/data:.*/);
            buf = new Buffer(res.body.urls[2].url.substring(res.body.urls[2].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x0f);
            expect(buf[1]).to.be(0x00);
            expect(buf.length).to.be(38);
            expect(res.body.urls[2].class).to.be("body");
        });

        it("should serve empty result sets", function(_) {
            let res = req("/reads/htsnexus_test/NA12878?format=CRAM&referenceName=20&start=1&end=10000", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.format).to.be('CRAM');
            expect(res.body.urls.length).to.be(2);

            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            let buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf.slice(0,4).toString()).to.be('CRAM');
            expect(res.body.urls[0].class).to.be("header");

            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/data:.*/);
            buf = new Buffer(res.body.urls[1].url.substring(res.body.urls[1].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x0f);
            expect(buf[1]).to.be(0x00);
            expect(buf.length).to.be(38);
            expect(res.body.urls[1].class).to.be("body");

            res = req("/reads/htsnexus_test/NA12878?format=CRAM&referenceName=XXX", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(2);

            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf.slice(0,4).toString()).to.be('CRAM');
            expect(res.body.urls[0].class).to.be("header");

            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/data:.*/);
            buf = new Buffer(res.body.urls[1].url.substring(res.body.urls[1].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x0f);
            expect(buf[1]).to.be(0x00);
            expect(buf.length).to.be(38);
            expect(res.body.urls[1].class).to.be("body");
        });
    });

    describe("GET variants", function() {
        it("should serve the URL for a VCF", function(_) {
            let res = req("/variants/htsnexus_test/1000genomes?format=VCF", _);
            expect(res.statusCode).to.be(200);
            expect(res.headers['access-control-allow-origin']).to.be('https://www.dnanexus.com');
            expect(res.body.urls.length).to.be(1);
            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/http.*/);
            expect(res.body.urls[0].headers.range).to.be("bytes=0-2595858");
            expect(res.body.urls[0].class).to.be(undefined);
            expect(res.body.format).to.be('VCF');
        });

        it("should serve the URL and byte range for a genomic range slice", function(_) {
            let res = req("/variants/htsnexus_test/1000genomes?format=VCF&referenceName=22&start=16000000&end=16300000", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(3);
            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/http.*/);
            expect(res.body.urls[1].class).to.be("body");
            expect(res.body.urls[1].headers.range).to.be("bytes=1853118-2378175");
            expect(res.body.format).to.be('VCF');
            expect(res.body.reference).to.be('GRCh37');

            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            let buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(res.body.urls[0].class).to.be("header");

            expect(res.body.urls[2].url).to.be.a('string');
            expect(res.body.urls[2].url).to.match(/data:.*/);
            buf = new Buffer(res.body.urls[2].url.substring(res.body.urls[2].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(buf.length).to.be(28);
            expect(res.body.urls[2].class).to.be("body");
        });

        it("should suppress VCF header slice prefix on request", function(_) {
            let res = req("/variants/htsnexus_test/1000genomes?format=VCF&referenceName=22&start=16000000&end=16300000&class=body", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(2);
            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/http.*/);
            expect(res.body.urls[0].headers.range).to.be("bytes=1853118-2378175");
            expect(res.body.format).to.be('VCF');
            expect(res.body.reference).to.be('GRCh37');
        });

        it("should provide VCF header-only on request", function(_) {
            let res = req("/variants/htsnexus_test/1000genomes?format=VCF&referenceName=22&start=16000000&end=16300000&class=header", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(2);
            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            let buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(res.body.urls[0].class).to.be("header");
            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/data:.*/);
            expect(res.body.urls[1].class).to.be("body");
            buf = new Buffer(res.body.urls[1].url.substring(res.body.urls[1].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(buf.length).to.be(28);
        });

        it("should serve the byte range for a whole reference sequence", function(_) {
            let res = req("/variants/htsnexus_test/1000genomes?format=VCF&referenceName=21", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(3);
            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/http.*/);
            expect(res.body.urls[1].class).to.be("body");
            expect(res.body.urls[1].headers.range).to.be("bytes=8748-1853761");
            expect(res.body.format).to.be('VCF');
            expect(res.body.reference).to.be('GRCh37');

            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            let buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(res.body.urls[0].class).to.be("header");

            expect(res.body.urls[2].url).to.be.a('string');
            expect(res.body.urls[2].url).to.match(/data:.*/);
            buf = new Buffer(res.body.urls[2].url.substring(res.body.urls[2].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(buf.length).to.be(28);
            expect(res.body.urls[2].class).to.be("body");
        });

        it("should serve empty result sets", function(_) {
            let res = req("/variants/htsnexus_test/1000genomes?referenceName=22&start=1&end=10000", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.format).to.be('VCF');
            expect(res.body.urls.length).to.be(2);

            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            let buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(res.body.urls[0].class).to.be("header");

            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/data:.*/);
            expect(res.body.urls[1].class).to.be("body");
            buf = new Buffer(res.body.urls[1].url.substring(res.body.urls[1].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(buf.length).to.be(28);

            res = req("/variants/htsnexus_test/1000genomes?referenceName=XXX", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.urls.length).to.be(2);

            expect(res.body.urls[0].url).to.be.a('string');
            expect(res.body.urls[0].url).to.match(/data:.*/);
            buf = new Buffer(res.body.urls[0].url.substring(res.body.urls[0].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(res.body.urls[0].class).to.be("header");

            expect(res.body.urls[1].url).to.be.a('string');
            expect(res.body.urls[1].url).to.match(/data:.*/);
            buf = new Buffer(res.body.urls[1].url.substring(res.body.urls[1].url.indexOf(',')+1), 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(buf.length).to.be(28);
            expect(res.body.urls[1].class).to.be("body");
        });
    });

    after(function(_) {
        if (server) {
            server.stop({timeout: 1000}, _);
        }
    });
});

describe("Azure subsystem", function() {
    const azure = require('../src/azure');

    it('should distinguish Azure blob URLs', function() {
        expect(azure.isBlobUrl("https://foobar.blob.core.windows.net/htsnexus/NA12878.cram")).to.be(true);
        expect(azure.isBlobUrl("https://foobar.blob.core.windows.net/htsnexus")).to.be(false);
        expect(azure.isBlobUrl("https://foobar.blob.core.windows.net")).to.be(false);
        expect(azure.isBlobUrl("https://www.dnanexus.com/htsnexus/NA12878.cram")).to.be(false);
    });

    it('should generate SAS url', function() {
        if (!process.env.AZURE_STORAGE_ACCOUNT || !process.env.AZURE_STORAGE_ACCESS_KEY) {
            this.skip();
        } else {
            const storageAccount = process.env.AZURE_STORAGE_ACCOUNT;
            azure.initialize({AZURE_STORAGE_ACCOUNT: storageAccount,
                              AZURE_STORAGE_ACCESS_KEY: process.env.AZURE_STORAGE_ACCESS_KEY});
            const signedUrl = azure.signBlobUrl("https://" + storageAccount + ".blob.core.windows.net/htsnexus/NA12878.cram", 60);
            const p = url.parse(signedUrl);
            expect(p.query.length).to.be.greaterThan(0);
            console.log(signedUrl);
        }
    });
});
