'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { parseXML } = require('../src/lib/xml');
const gdtf = require('../src/lib/gdtf');
const mvr = require('../src/lib/mvr');
const sacn = require('../src/lib/sacn');
const { demoRig, demoFrame } = require('../src/lib/demo');
const { cieToRgb } = require('../src/lib/color');

const GDTF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<GDTF DataVersion="1.2">
  <FixtureType Name="Test Spot 300" ShortName="TS300" Manufacturer="LightBox" FixtureTypeID="abc">
    <Wheels>
      <Wheel Name="Color1">
        <Slot Name="Open" Color="0.3127,0.3290,100"/>
        <Slot Name="Red" Color="0.64,0.33,21"/>
        <Slot Name="Blue" Color="0.15,0.06,7"/>
      </Wheel>
    </Wheels>
    <Geometries>
      <Axis Name="Yoke"><Axis Name="Head">
        <Beam Name="Beam" BeamAngle="12" FieldAngle="18" LuminousFlux="15000" ColorTemperature="7000" BeamType="Spot"/>
      </Axis></Axis>
    </Geometries>
    <DMXModes>
      <DMXMode Name="Standard" Geometry="Base">
        <DMXChannels>
          <DMXChannel Offset="1,2" Default="32768/2" Geometry="Yoke">
            <LogicalChannel Attribute="Pan"><ChannelFunction Attribute="Pan" DMXFrom="0/1" PhysicalFrom="-270" PhysicalTo="270"/></LogicalChannel>
          </DMXChannel>
          <DMXChannel Offset="3,4" Default="32768/2" Geometry="Head">
            <LogicalChannel Attribute="Tilt"><ChannelFunction Attribute="Tilt" DMXFrom="0/1" PhysicalFrom="-120" PhysicalTo="120"/></LogicalChannel>
          </DMXChannel>
          <DMXChannel Offset="5" Geometry="Beam">
            <LogicalChannel Attribute="Dimmer"><ChannelFunction Attribute="Dimmer" DMXFrom="0/1" PhysicalFrom="0" PhysicalTo="1"/></LogicalChannel>
          </DMXChannel>
          <DMXChannel Offset="6" Geometry="Beam">
            <LogicalChannel Attribute="Shutter1">
              <ChannelFunction Name="Closed" Attribute="Shutter1" DMXFrom="0/1" PhysicalFrom="0" PhysicalTo="0"/>
              <ChannelFunction Name="Open" Attribute="Shutter1" DMXFrom="8/1" PhysicalFrom="1" PhysicalTo="1"/>
              <ChannelFunction Name="Strobe" Attribute="Shutter1Strobe" DMXFrom="16/1" PhysicalFrom="1" PhysicalTo="20"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel Offset="7" Geometry="Beam">
            <LogicalChannel Attribute="Color1">
              <ChannelFunction Attribute="Color1" DMXFrom="0/1" Wheel="Color1">
                <ChannelSet Name="Open" DMXFrom="0/1" WheelSlotIndex="1"/>
                <ChannelSet Name="Red" DMXFrom="10/1" WheelSlotIndex="2"/>
                <ChannelSet Name="Blue" DMXFrom="20/1" WheelSlotIndex="3"/>
              </ChannelFunction>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel Offset="8" Geometry="Beam">
            <LogicalChannel Attribute="Zoom"><ChannelFunction Attribute="Zoom" DMXFrom="0/1" PhysicalFrom="10" PhysicalTo="40"/></LogicalChannel>
          </DMXChannel>
          <DMXChannel Offset="None" Geometry="Beam">
            <LogicalChannel Attribute="Focus1"><ChannelFunction Attribute="Focus1"/></LogicalChannel>
          </DMXChannel>
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>`;

const MVR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<GeneralSceneDescription verMajor="1" verMinor="6" provider="test">
  <Scene>
    <Layers>
      <Layer name="Rig" uuid="L1">
        <Matrix>{1,0,0}{0,1,0}{0,0,1}{0,0,1000}</Matrix>
        <ChildList>
          <GroupObject name="Truss group" uuid="G1">
            <Matrix>{1,0,0}{0,1,0}{0,0,1}{0,0,6000}</Matrix>
            <ChildList>
              <Truss name="T1" uuid="T1"><Matrix>{1,0,0}{0,1,0}{0,0,1}{0,0,0}</Matrix><Geometries><Geometry3D fileName="truss.3ds"/></Geometries></Truss>
              <Fixture name="Spot 1" uuid="F1">
                <Matrix>{1,0,0}{0,-1,0}{0,0,-1}{-1500,0,-300}</Matrix>
                <GDTFSpec>test.gdtf</GDTFSpec>
                <GDTFMode>Standard</GDTFMode>
                <FixtureID>101</FixtureID>
                <Color>0.64,0.33,21</Color>
                <Addresses><Address break="0">1</Address></Addresses>
              </Fixture>
              <Fixture name="Spot 2" uuid="F2">
                <Matrix>{1,0,0}{0,-1,0}{0,0,-1}{1500,0,-300}</Matrix>
                <GDTFSpec>test.gdtf</GDTFSpec>
                <GDTFMode>Standard</GDTFMode>
                <FixtureID>102</FixtureID>
                <Addresses><Address break="0">521</Address></Addresses>
              </Fixture>
            </ChildList>
          </GroupObject>
        </ChildList>
      </Layer>
    </Layers>
  </Scene>
</GeneralSceneDescription>`;

async function makeGdtfZip() {
  const z = new JSZip();
  z.file('description.xml', GDTF_XML);
  return z.generateAsync({ type: 'nodebuffer' });
}
async function makeMvrZip() {
  const z = new JSZip();
  z.file('GeneralSceneDescription.xml', MVR_XML);
  z.file('test.gdtf', await makeGdtfZip());
  return z.generateAsync({ type: 'nodebuffer' });
}

test('xml parser handles attributes, entities, self-closing, cdata', () => {
  const doc = parseXML(`<a x="1 &amp; 2" y='q'><b/><c>hi<![CDATA[<raw>]]></c><!-- comment --></a>`);
  const a = doc.children[0];
  assert.equal(a.name, 'a');
  assert.equal(a.attrs.x, '1 & 2');
  assert.equal(a.attrs.y, 'q');
  assert.equal(a.children.length, 2);
  assert.equal(a.children[1].text, 'hi<raw>');
});

test('gdtf: modes, offsets, physical ranges, wheels, beam', async () => {
  const p = await gdtf.parseGdtfBuffer(await makeGdtfZip());
  assert.equal(p.name, 'Test Spot 300');
  assert.equal(p.isMovingHead, true);
  assert.deepEqual(p.pan, { from: -270, to: 270 });
  assert.deepEqual(p.tilt, { from: -120, to: 120 });
  assert.deepEqual(p.zoom, { from: 10, to: 40 });
  assert.equal(p.beam.beamAngle, 12);
  assert.equal(p.beam.colorTemp, 7000);
  const m = p.modes[0];
  assert.equal(m.name, 'Standard');
  assert.equal(m.footprint, 8);
  const pan = m.channels[0];
  assert.deepEqual(pan.offsets, [1, 2]);
  assert.equal(pan.bytes, 2);
  assert.equal(pan.default, 32768);
  const shutter = m.channels[3];
  assert.equal(shutter.functions.length, 3);
  assert.equal(shutter.functions[0].dmxTo, 7);
  assert.equal(shutter.functions[1].dmxFrom, 8);
  assert.equal(shutter.functions[2].dmxTo, 255);
  const color = m.channels[4];
  assert.equal(color.functions[0].wheel, 'Color1');
  assert.equal(color.functions[0].sets[1].wheelSlot, 2);
  assert.equal(color.functions[0].sets[1].dmxTo, 19);
  assert.equal(p.wheels.Color1.length, 3);
  const red = p.wheels.Color1[1].rgb;
  assert.ok(red[0] > 0.9 && red[1] < 0.3 && red[2] < 0.3, `red slot → ${red}`);
  // virtual channel is kept but has no offsets
  assert.equal(m.channels.length, 7);
  assert.deepEqual(m.channels[6].offsets, []);
});

test('gdtf: runtime helpers map raw DMX to physical values', async () => {
  const p = await gdtf.parseGdtfBuffer(await makeGdtfZip());
  const ch = p.modes[0].channels[0]; // pan 16-bit
  const dmx = new Uint8Array(512);
  dmx[0] = 0x80;
  dmx[1] = 0x00;
  const raw = gdtf.readChannelRaw(ch, dmx, 0);
  assert.equal(raw, 32768);
  const fn = gdtf.functionFor(ch, raw);
  assert.ok(Math.abs(gdtf.physical(fn, raw)) < 0.01, 'centre pan ≈ 0°');
  assert.equal(gdtf.physical(fn, 65535), 270);
  assert.equal(gdtf.parseDmxValue('255/1', 2), 65535);
  assert.equal(gdtf.parseDmxValue('1/1s', 2), 256);
});

test('mvr: fixtures, nested matrices, patch, embedded gdtf', async () => {
  const r = await mvr.parseMvrBuffer(await makeMvrZip());
  assert.equal(r.missing.length, 0);
  assert.ok(r.profiles['test.gdtf']);
  assert.equal(r.scene.fixtures.length, 2);
  assert.equal(r.scene.trusses.length, 1);
  const f1 = r.scene.fixtures[0];
  assert.equal(f1.fixtureId, '101');
  assert.equal(f1.gdtfMode, 'Standard');
  assert.equal(f1.universe, 1);
  assert.equal(f1.address, 1);
  // layer z=1000 + group z=6000 + fixture z=-300 = 6700
  assert.deepEqual(f1.matrix.o, [-1500, 0, 6700]);
  assert.deepEqual(f1.matrix.w, [0, 0, -1]);
  assert.ok(f1.color && f1.color[0] > 0.9);
  const f2 = r.scene.fixtures[1];
  assert.equal(f2.universe, 2);
  assert.equal(f2.address, 9);
});

test('mvr: address parsing boundaries', () => {
  const mk = (v) => ({ attrs: { break: '0' }, text: String(v), children: [] });
  assert.deepEqual(mvr.parseAddress(mk(512)), { abs: 512, universe: 1, address: 512, break: 0 });
  assert.deepEqual(mvr.parseAddress(mk(513)), { abs: 513, universe: 2, address: 1, break: 0 });
});

test('sacn: encode/decode round trip', () => {
  const data = new Uint8Array(512);
  data[0] = 255;
  data[511] = 7;
  const pkt = sacn.encodePacket({ universe: 5, data, priority: 120, sequence: 9, sourceName: 'grandMA3 onPC' });
  const d = sacn.decodePacket(pkt);
  assert.ok(d);
  assert.equal(d.universe, 5);
  assert.equal(d.priority, 120);
  assert.equal(d.sequence, 9);
  assert.equal(d.sourceName, 'grandMA3 onPC');
  assert.equal(d.startCode, 0);
  assert.equal(d.data.length, 512);
  assert.equal(d.data[0], 255);
  assert.equal(d.data[511], 7);
  assert.equal(sacn.multicastAddress(1), '239.255.0.1');
  assert.equal(sacn.multicastAddress(300), '239.255.1.44');
  assert.equal(sacn.decodePacket(Buffer.alloc(50)), null);
});

test('sacn: receiver merges by priority then HTP', () => {
  const rx = new sacn.SacnReceiver();
  rx.listen(1);
  const a = new Uint8Array(512);
  a[0] = 100;
  a[1] = 200;
  const b = new Uint8Array(512);
  b[0] = 150;
  b[1] = 50;
  const cidA = Buffer.alloc(16, 1);
  const cidB = Buffer.alloc(16, 2);
  let last = null;
  rx.on('dmx', (e) => (last = Uint8Array.from(e.data)));
  rx._onMessage(sacn.encodePacket({ universe: 1, data: a, priority: 100, cid: cidA }));
  rx._onMessage(sacn.encodePacket({ universe: 1, data: b, priority: 100, cid: cidB }));
  assert.deepEqual([last[0], last[1]], [150, 200], 'HTP at equal priority');
  rx._onMessage(sacn.encodePacket({ universe: 1, data: b, priority: 150, cid: cidB }));
  assert.deepEqual([last[0], last[1]], [150, 50], 'higher priority wins');
  assert.equal(rx.status().universes[0].sources.length, 2);
});

test('demo rig and frame are consistent', () => {
  const r = demoRig();
  assert.equal(r.scene.fixtures.length, 36);
  const last = r.scene.fixtures[r.scene.fixtures.length - 1];
  const fp = r.profiles[last.gdtfSpec].modes[0].footprint;
  assert.ok(last.address + fp - 1 <= 512, 'demo rig fits in one universe');
  const f = demoFrame(1.5);
  assert.equal(f.length, 512);
  assert.equal(f[9], 12, 'spot 1 shutter open');
});

test('colour: cie → rgb sanity', () => {
  const w = cieToRgb('0.3127,0.3290,100');
  assert.ok(w.every((c) => c > 0.9), `D65 white ≈ white: ${w}`);
  const b = cieToRgb('0.15,0.06,7');
  assert.ok(b[2] > 0.9 && b[0] < 0.5, `blue: ${b}`);
});
