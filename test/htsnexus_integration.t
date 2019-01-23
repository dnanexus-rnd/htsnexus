#!/bin/bash
set -o pipefail

cd "${HTSNEXUS_HOME}"
source test/bash-tap-bootstrap

plan tests 76

# use htsnexus_index_bam to build the test database
DBFN="${TMPDIR}/htsnexus_integration_test.db"
rm -f "$DBFN"

indexer/htsnexus_index_bam "${DBFN}" ENCODE ENCFF621SXE xxx "https://www.encodeproject.org/files/ENCFF621SXE/@@download/ENCFF621SXE.bam"
is "$?" "0" "add unindexed BAM"
find "$DBFN" -type f > /dev/null
is "$?" "0" "generate database"

indexer/htsnexus_index_bam --reference GRCh37 "$DBFN" htsnexus_test NA12878 test/htsnexus_test_NA12878.bam "https://dl.dnanex.us/F/D/pjZ1Z8fpYzKj5Z8v3qXzVfffV1XzkXk4Kg4KzGBY/htsnexus_test_NA12878.bam"
is "$?" "0" "index BAM"

indexer/src/htsnexus_downsample_index.py "$DBFN"
is "$?" "0" "downsample index"

# start the server
server_pid=""
function cleanup {
	if [ -n "$server_pid" ]; then
		echo "killing htsnexus test server pid=$server_pid"
		pkill -P $server_pid || true
	fi
}
trap cleanup EXIT

server/server.sh "$DBFN" &
server_pid=$!

sleep 2
ps -p $server_pid
is "$?" "0" "server startup"

samtools=indexer/external/src/samtools/samtools

# perform some queries
output=$(client/htsnexus.py -v -s http://localhost:48444/v1/reads htsnexus_test NA12878 | $samtools view -c -)
is "$?" "0" "read entire BAM"
is "$output" "39918" "read entire BAM - record count"

output=$(client/htsnexus.py -v -s http://localhost:48444/v1/reads -r 20 htsnexus_test NA12878 | $samtools view -c -)
is "$?" "0" "read BAM chromosome slice"
is "$output" "14955" "read BAM chromosome slice - approximate record count"

BAMFN="${TMPDIR}/htsnexus_integration_test.bam"
rm -f "$BAMFN"
client/htsnexus.py -s http://localhost:48444/v1/reads -r 20 htsnexus_test NA12878 > "$BAMFN"
is "$?" "0" "read BAM chromosome slice to file"
is "$($samtools view -c "$BAMFN")" "14955" "read BAM chromosome slice to file - approximate record count"
$samtools index "$BAMFN"
is "$?" "0" "index local BAM chromosome slice"
is "$($samtools view -c "$BAMFN" 20)" "14545" "read BAM chromosome slice to file - exact record count"

client/htsnexus.py -s http://localhost:48444/v1/reads -r 11:5005000-5006000 htsnexus_test NA12878 > "$BAMFN"
is "$?" "0" "read BAM range slice to file"
is "$($samtools view -c "$BAMFN")" "217" "read BAM range slice to file - approximate record count"
$samtools index "$BAMFN"
is "$?" "0" "index local BAM range slice"
is "$($samtools view -c "$BAMFN" 11:5005000-5006000)" "32" "read BAM range slice to file - exact record count"

client/htsnexus.py -s http://localhost:48444/v1/reads -r "*" htsnexus_test NA12878 > "$BAMFN"
is "$?" "0" "read BAM unplaced reads slice"
is "$($samtools view -c "$BAMFN")" "12551" "read BAM unplaced reads - approximate record count"
$samtools index "$BAMFN"
is "$?" "0" "index local BAM unplaced reads slice"
is "$($samtools view "$BAMFN" | awk "\$3 == \"*\" {print;}" | wc -l)" "12475" "read BAM unplaced reads - exact record count"

is "$($samtools view -H "$BAMFN" | wc -l)" "103" "BAM header in slice"

output=$(client/htsnexus.py -s http://localhost:48444/v1/reads --header-only htsnexus_test NA12878 | $samtools view -c -)
is "$?" "0" "read BAM header only"
is "$output" "0" "read BAM header only"

output=$(client/htsnexus.py -s http://localhost:48444/v1/reads -r 21 htsnexus_test NA12878 | $samtools view -c -)
is "$?" "0" "read BAM empty range slice"
is "$output" "0" "read BAM empty range slice"

output=$(client/htsnexus.py -s http://localhost:48444/v1/reads -r 21 htsnexus_test NA12878 | $samtools view -c -)
is "$?" "0" "read BAM empty chromosome slice"
is "$output" "0" "read BAM empty chromosome slice"

output=$(client/htsnexus.py -s http://localhost:48444/v1/reads lh3bamsvr EXA00001 | $samtools view -c -)
is "$?" "0" "read entire BAM from Heng Li's bamsvr"
is "$output" "413102" "read entire BAM from Heng Li's bamsvr - record count"

output=$(client/htsnexus.py -s http://localhost:48444/v1/reads -r 11:10899000-10900000 lh3bamsvr EXA00001 | $samtools view -c -)
is "$?" "0" "read BAM slice from Heng Li's bamsvr"
is "$output" "7820" "read BAM slice from Heng Li's bamsvr - record count"

rm -f "${TMPDIR}/htsnexus_integration_test.stderr"
(client/htsnexus.py -v -s http://localhost:48444/dxjob/v1/reads -r 11:5005000-5006000 htsnexus_test NA12878 > /dev/null 2> "${TMPDIR}/htsnexus_integration_test.stderr") || true
grep "http://10.0.3.1:8090/" "${TMPDIR}/htsnexus_integration_test.stderr"
is "$?" "0" "DNAnexus-optimized URL rewrite"

########
# CRAM #
########

indexer/htsnexus_index_cram --reference GRCh37 "$DBFN" htsnexus_test NA12878 test/htsnexus_test_NA12878.cram "https://dl.dnanex.us/F/D/fkx3bPPfXP8F0z61bfGJ8JkjZ05fBpyyyZy8jf1Z/htsnexus_test_NA12878.cram"
is "$?" "0" "index CRAM"

output=$((client/htsnexus.py -s http://localhost:48444/v1/reads htsnexus_test NA12878 cram || true) | head -c 4)
is "$?" "0" "get CRAM (CalledProcessError above is normal)"
is "$output" "CRAM" "get CRAM"

# samtools will need to access the hs37d5 reference. It'll fetch it from EBI
# automatically and cache it by default under ~/.cache/hts-ref/ which can be
# overridden with the REF_CACHE env variable. TODO: it'd be nice to make test
# CRAMs against a synthetic tiny reference genome...
output=$(client/htsnexus.py -v -s http://localhost:48444/v1/reads htsnexus_test NA12878 cram | $samtools view -c -)
is "$?" "0" "read entire CRAM"
is "$output" "39918" "read entire CRAM - record count"

output=$(client/htsnexus.py -v -s http://localhost:48444/v1/reads -r 20 htsnexus_test NA12878 cram | $samtools view -c -)
is "$?" "0" "read CRAM chromosome slice"
is "$output" "14545" "read CRAM chromosome slice - record count"

CRAMFN="${TMPDIR}/htsnexus_integration_test.cram"
rm -f "$CRAMFN"
client/htsnexus.py -s http://localhost:48444/v1/reads -r 20 htsnexus_test NA12878 cram > "$CRAMFN"
is "$?" "0" "read CRAM chromosome slice to file"
is $(head -c 4 "$CRAMFN") "CRAM" "read CRAM chromosome slice and get a CRAM file"
$samtools index "$CRAMFN"
is "$?" "0" "index local CRAM chromosome slice"
is "$($samtools view -c "$CRAMFN" 20)" "14545" "read CRAM chromosome slice to file - exact record count"

client/htsnexus.py -s http://localhost:48444/v1/reads -r 11:5005000-5006000 htsnexus_test NA12878 cram > "$CRAMFN"
is "$?" "0" "read CRAM range slice to file"
is $(head -c 4 "$CRAMFN") "CRAM" "read CRAM range slice and get a CRAM file"
is "$($samtools view -c "$CRAMFN")" "10000" "read CRAM range slice to file - approximate record count"
$samtools index "$CRAMFN"
is "$?" "0" "index local CRAM range slice"
is "$($samtools view -c "$CRAMFN" 11:5005000-5006000)" "32" "read CRAM range slice to file - exact record count"

client/htsnexus.py -s http://localhost:48444/v1/reads -r "*" htsnexus_test NA12878 cram > "$CRAMFN"
is "$?" "0" "read CRAM unplaced reads slice"
is $(head -c 4 "$CRAMFN") "CRAM" "read CRAM unplaced reads and get a CRAM file"
is "$($samtools view -c "$CRAMFN")" "12475" "read CRAM unplaced reads - record count"
$samtools index "$CRAMFN"
is "$?" "0" "index local CRAM unplaced reads slice"
is "$($samtools view "$CRAMFN" | awk "\$3 == \"*\" {print;}" | wc -l)" "12475" "read CRAM unplaced reads - slice record count"

is "$($samtools view -H "$CRAMFN" | wc -l)" "103" "CRAM header in slice"

output=$(client/htsnexus.py -s http://localhost:48444/v1/reads --header-only htsnexus_test NA12878 cram | $samtools view -c -)
is "$?" "0" "read CRAM header only"
is "$output" "0" "read CRAM header only"

output=$(client/htsnexus.py -s http://localhost:48444/v1/reads -r 21 htsnexus_test NA12878 cram | $samtools view -c -)
is "$?" "0" "read CRAM empty range slice"
is "$output" "0" "read CRAM empty range slice"

output=$(client/htsnexus.py -s http://localhost:48444/v1/reads -r 21 htsnexus_test NA12878 cram | $samtools view -c -)
is "$?" "0" "read CRAM empty chromosome slice"
is "$output" "0" "read CRAM empty chromosome slice"

########
# VCF #
########

gunzip -dc test/htsnexus_test_1000G.vcf.gz | indexer/bgzip_lines > "${TMPDIR}/htsnexus_test_1000G.vcf.gz"
indexer/htsnexus_index_vcf --reference GRCh37 "$DBFN" htsnexus_test 1000genomes "${TMPDIR}/htsnexus_test_1000G.vcf.gz" "https://dl.dnanex.us/F/D/fQVjxXPJPbK76QBB8jzvG3F6PBqbj0YY8q277qXK/htsnexus_test_1000G.vcf.gz"
is "$?" "0" "index VCF"

# the following url says 'reads' intentionally, to test client compatibility hack.
output=$((client/htsnexus.py -s http://localhost:48444/v1/reads htsnexus_test 1000genomes VCF || true) | gzip -dc | wc -l)
is "$?" "0" "read entire VCF"
is "$output" "15000" "read entire VCF - line count"

VCFFN="${TMPDIR}/htsnexus_integration_test.vcf"
rm -f "$VCFFN"
client/htsnexus.py -v -s http://localhost:48444/v1/variants -r 22 htsnexus_test 1000genomes VCF | gzip -dc > "$VCFFN"
is "$?" "0" "read VCF chromosome slice"
is "$(cat "${VCFFN}" | wc -l)" "5256" "read VCF chromosome slice - line count"
is "$(egrep "^22" "${VCFFN}" | wc -l)" "5000" "read VCF chromosome slice - record count"

client/htsnexus.py -v -s http://localhost:48444/v1/variants -r 22:16000000-16300000 htsnexus_test 1000genomes VCF | gzip -dc > "$VCFFN"
is "$?" "0" "read VCF range slice"
is "$(cat "${VCFFN}" | wc -l)" "3397" "read VCF range slice - line count"
is "$(egrep "^22" "${VCFFN}" | wc -l)" "3141" "read VCF range slice - record count"

client/htsnexus.py -v -s http://localhost:48444/v1/variants -r 20 htsnexus_test 1000genomes VCF | gzip -dc > "$VCFFN"
is "$?" "0" "read VCF empty range slice"
is "$(cat "${VCFFN}" | wc -l)" "253" "read VCF empty range slice - line count"
is "$(egrep -v "^#" "${VCFFN}" | wc -l)" "0" "read VCF empty range slice - record count"

client/htsnexus.py -v -s http://localhost:48444/v1/variants --header-only htsnexus_test 1000genomes VCF | gzip -dc > "$VCFFN"
is "$?" "0" "read VCF header only"
is "$(cat "${VCFFN}" | wc -l)" "253" "read VCF header only - line count"
is "$(egrep -v "^#" "${VCFFN}" | wc -l)" "0" "read VCF header only - record count"
