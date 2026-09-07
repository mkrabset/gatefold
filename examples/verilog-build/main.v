module counter4bit (
  input CLK,
  output [3:0] VAL,
  output reg Q
);
  reg DFF_Q;
  reg DFF_Q_2;
  reg DFF_Q_3;
  wire DFF__Q;
  wire DFF__Q_2;
  wire DFF__Q_3;
  wire DFF__Q_4;
  wire _BUS;
  wire _Y;
  always @(posedge CLK or posedge _Y) if (_Y) DFF_Q <= 1'b0; else DFF_Q <= DFF__Q;
  assign DFF__Q = ~(DFF_Q);
  always @(posedge DFF_Q or posedge _Y) if (_Y) DFF_Q_2 <= 1'b0; else DFF_Q_2 <= DFF__Q_2;
  assign DFF__Q_2 = ~(DFF_Q_2);
  always @(posedge DFF_Q_2 or posedge _Y) if (_Y) DFF_Q_3 <= 1'b0; else DFF_Q_3 <= DFF__Q_3;
  assign DFF__Q_3 = ~(DFF_Q_3);
  always @(posedge DFF_Q_3 or posedge _Y) if (_Y) Q <= 1'b0; else Q <= DFF__Q_4;
  assign DFF__Q_4 = ~(Q);
  assign _BUS = {1{1'b0}};
  assign _Y = _BUS;
  assign VAL = {DFF__Q_4, DFF__Q_3, DFF__Q_2, DFF__Q};
endmodule

module counter4bit_2 (
  input CLK,
  output [3:0] VAL,
  output reg Q
);
  reg DFF_Q;
  reg DFF_Q_2;
  reg DFF_Q_3;
  wire DFF__Q;
  wire DFF__Q_2;
  wire DFF__Q_3;
  wire DFF__Q_4;
  wire _BUS;
  wire _Y;
  always @(posedge CLK or posedge _Y) if (_Y) DFF_Q <= 1'b0; else DFF_Q <= DFF__Q;
  assign DFF__Q = ~(DFF_Q);
  always @(posedge DFF_Q or posedge _Y) if (_Y) DFF_Q_2 <= 1'b0; else DFF_Q_2 <= DFF__Q_2;
  assign DFF__Q_2 = ~(DFF_Q_2);
  always @(posedge DFF_Q_2 or posedge _Y) if (_Y) DFF_Q_3 <= 1'b0; else DFF_Q_3 <= DFF__Q_3;
  assign DFF__Q_3 = ~(DFF_Q_3);
  always @(posedge DFF_Q_3 or posedge _Y) if (_Y) Q <= 1'b0; else Q <= DFF__Q_4;
  assign DFF__Q_4 = ~(Q);
  assign _BUS = {1{1'b0}};
  assign _Y = _BUS;
  assign VAL = {DFF__Q_4, DFF__Q_3, DFF__Q_2, DFF__Q};
endmodule

module counter4bit_3 (
  input CLK,
  output [3:0] VAL,
  output reg Q
);
  reg DFF_Q;
  reg DFF_Q_2;
  reg DFF_Q_3;
  wire DFF__Q;
  wire DFF__Q_2;
  wire DFF__Q_3;
  wire DFF__Q_4;
  wire _BUS;
  wire _Y;
  always @(posedge CLK or posedge _Y) if (_Y) DFF_Q <= 1'b0; else DFF_Q <= DFF__Q;
  assign DFF__Q = ~(DFF_Q);
  always @(posedge DFF_Q or posedge _Y) if (_Y) DFF_Q_2 <= 1'b0; else DFF_Q_2 <= DFF__Q_2;
  assign DFF__Q_2 = ~(DFF_Q_2);
  always @(posedge DFF_Q_2 or posedge _Y) if (_Y) DFF_Q_3 <= 1'b0; else DFF_Q_3 <= DFF__Q_3;
  assign DFF__Q_3 = ~(DFF_Q_3);
  always @(posedge DFF_Q_3 or posedge _Y) if (_Y) Q <= 1'b0; else Q <= DFF__Q_4;
  assign DFF__Q_4 = ~(Q);
  assign _BUS = {1{1'b0}};
  assign _Y = _BUS;
  assign VAL = {DFF__Q_4, DFF__Q_3, DFF__Q_2, DFF__Q};
endmodule

module counter4bit_4 (
  input CLK,
  output [3:0] VAL,
  output reg Q
);
  reg DFF_Q;
  reg DFF_Q_2;
  reg DFF_Q_3;
  wire DFF__Q;
  wire DFF__Q_2;
  wire DFF__Q_3;
  wire DFF__Q_4;
  wire _BUS;
  wire _Y;
  always @(posedge CLK or posedge _Y) if (_Y) DFF_Q <= 1'b0; else DFF_Q <= DFF__Q;
  assign DFF__Q = ~(DFF_Q);
  always @(posedge DFF_Q or posedge _Y) if (_Y) DFF_Q_2 <= 1'b0; else DFF_Q_2 <= DFF__Q_2;
  assign DFF__Q_2 = ~(DFF_Q_2);
  always @(posedge DFF_Q_2 or posedge _Y) if (_Y) DFF_Q_3 <= 1'b0; else DFF_Q_3 <= DFF__Q_3;
  assign DFF__Q_3 = ~(DFF_Q_3);
  always @(posedge DFF_Q_3 or posedge _Y) if (_Y) Q <= 1'b0; else Q <= DFF__Q_4;
  assign DFF__Q_4 = ~(Q);
  assign _BUS = {1{1'b0}};
  assign _Y = _BUS;
  assign VAL = {DFF__Q_4, DFF__Q_3, DFF__Q_2, DFF__Q};
endmodule

module counter4bit_5 (
  input CLK,
  output [3:0] VAL,
  output reg Q
);
  reg DFF_Q;
  reg DFF_Q_2;
  reg DFF_Q_3;
  wire DFF__Q;
  wire DFF__Q_2;
  wire DFF__Q_3;
  wire DFF__Q_4;
  wire _BUS;
  wire _Y;
  always @(posedge CLK or posedge _Y) if (_Y) DFF_Q <= 1'b0; else DFF_Q <= DFF__Q;
  assign DFF__Q = ~(DFF_Q);
  always @(posedge DFF_Q or posedge _Y) if (_Y) DFF_Q_2 <= 1'b0; else DFF_Q_2 <= DFF__Q_2;
  assign DFF__Q_2 = ~(DFF_Q_2);
  always @(posedge DFF_Q_2 or posedge _Y) if (_Y) DFF_Q_3 <= 1'b0; else DFF_Q_3 <= DFF__Q_3;
  assign DFF__Q_3 = ~(DFF_Q_3);
  always @(posedge DFF_Q_3 or posedge _Y) if (_Y) Q <= 1'b0; else Q <= DFF__Q_4;
  assign DFF__Q_4 = ~(Q);
  assign _BUS = {1{1'b0}};
  assign _Y = _BUS;
  assign VAL = {DFF__Q_4, DFF__Q_3, DFF__Q_2, DFF__Q};
endmodule

module counter4bit_6 (
  input CLK,
  output [3:0] VAL,
  output reg Q
);
  reg DFF_Q;
  reg DFF_Q_2;
  reg DFF_Q_3;
  wire DFF__Q;
  wire DFF__Q_2;
  wire DFF__Q_3;
  wire DFF__Q_4;
  wire _BUS;
  wire _Y;
  always @(posedge CLK or posedge _Y) if (_Y) DFF_Q <= 1'b0; else DFF_Q <= DFF__Q;
  assign DFF__Q = ~(DFF_Q);
  always @(posedge DFF_Q or posedge _Y) if (_Y) DFF_Q_2 <= 1'b0; else DFF_Q_2 <= DFF__Q_2;
  assign DFF__Q_2 = ~(DFF_Q_2);
  always @(posedge DFF_Q_2 or posedge _Y) if (_Y) DFF_Q_3 <= 1'b0; else DFF_Q_3 <= DFF__Q_3;
  assign DFF__Q_3 = ~(DFF_Q_3);
  always @(posedge DFF_Q_3 or posedge _Y) if (_Y) Q <= 1'b0; else Q <= DFF__Q_4;
  assign DFF__Q_4 = ~(Q);
  assign _BUS = {1{1'b0}};
  assign _Y = _BUS;
  assign VAL = {DFF__Q_4, DFF__Q_3, DFF__Q_2, DFF__Q};
endmodule

module counter4bit_7 (
  input CLK,
  output [3:0] VAL,
  output reg Q
);
  reg DFF_Q;
  reg DFF_Q_2;
  reg DFF_Q_3;
  wire DFF__Q;
  wire DFF__Q_2;
  wire DFF__Q_3;
  wire DFF__Q_4;
  wire _BUS;
  wire _Y;
  always @(posedge CLK or posedge _Y) if (_Y) DFF_Q <= 1'b0; else DFF_Q <= DFF__Q;
  assign DFF__Q = ~(DFF_Q);
  always @(posedge DFF_Q or posedge _Y) if (_Y) DFF_Q_2 <= 1'b0; else DFF_Q_2 <= DFF__Q_2;
  assign DFF__Q_2 = ~(DFF_Q_2);
  always @(posedge DFF_Q_2 or posedge _Y) if (_Y) DFF_Q_3 <= 1'b0; else DFF_Q_3 <= DFF__Q_3;
  assign DFF__Q_3 = ~(DFF_Q_3);
  always @(posedge DFF_Q_3 or posedge _Y) if (_Y) Q <= 1'b0; else Q <= DFF__Q_4;
  assign DFF__Q_4 = ~(Q);
  assign _BUS = {1{1'b0}};
  assign _Y = _BUS;
  assign VAL = {DFF__Q_4, DFF__Q_3, DFF__Q_2, DFF__Q};
endmodule

module main (
  output out1,
  output out2,
  output out3,
  output out4,
  output Q,
  input CLOCK_CLK
);
  wire _Q;
  wire _Q_2;
  wire _Q_3;
  wire _Q_4;
  wire _Q_5;
  wire _Q_6;
  wire [3:0] _VAL;
  wire [3:0] _VAL_2;
  wire [3:0] _VAL_3;
  wire [3:0] _VAL_4;
  wire [3:0] _VAL_5;
  wire [3:0] _VAL_6;
  wire [3:0] _VAL_7;
  counter4bit u (
    .CLK(_Q),
    .VAL(_VAL),
    .Q(_Q_2)
  );
  counter4bit_2 u_2 (
    .CLK(_Q_2),
    .VAL(_VAL_2),
    .Q(_Q_3)
  );
  counter4bit_3 u_3 (
    .CLK(_Q_3),
    .VAL(_VAL_3),
    .Q(_Q_4)
  );
  counter4bit_4 u_4 (
    .CLK(_Q_4),
    .VAL(_VAL_4),
    .Q(Q)
  );
  assign out1 = _VAL_4[0];
  assign out2 = _VAL_4[1];
  assign out3 = _VAL_4[2];
  assign out4 = _VAL_4[3];
  counter4bit_5 u_5 (
    .CLK(CLOCK_CLK),
    .VAL(_VAL_5),
    .Q(_Q_5)
  );
  counter4bit_6 u_6 (
    .CLK(_Q_5),
    .VAL(_VAL_6),
    .Q(_Q_6)
  );
  counter4bit_7 u_7 (
    .CLK(_Q_6),
    .VAL(_VAL_7),
    .Q(_Q)
  );
endmodule
