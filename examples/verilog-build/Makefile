TOP      := main
PCF      := upduino.pcf

DEVICE   := up5k
PACKAGE  := sg48

JSON     := $(TOP).json
ASC      := $(TOP).asc
BIN      := $(TOP).bin

YOSYS    := yosys
NEXTPNR  := nextpnr-ice40
ICEPACK  := icepack
LOADER   := openFPGALoader

.PHONY: all build install program flash stat clean scan

all: build

build: $(BIN)

$(JSON): $(TOP).v
	$(YOSYS) -p 'synth_ice40 -top $(TOP) -json $@' $<

$(ASC): $(JSON) $(PCF)
	$(NEXTPNR) \
		--$(DEVICE) \
		--package $(PACKAGE) \
		--json $(JSON) \
		--pcf $(PCF) \
		--asc $@

$(BIN): $(ASC)
	$(ICEPACK) $< $@

# Program the UPduino 3.1 configuration flash.
# This is persistent across power cycles.
install program flash: $(BIN)
	$(LOADER) \
		-b ice40_generic \
		-c ft232 \
		-f $(BIN)

# Show synthesized resource usage.
stat:
	$(YOSYS) -p 'read_verilog $(TOP).v; synth_ice40 -top $(TOP); stat'

# Show USB devices recognized by openFPGALoader.
scan:
	$(LOADER) --scan-usb

clean:
	rm -f $(JSON) $(ASC) $(BIN)

