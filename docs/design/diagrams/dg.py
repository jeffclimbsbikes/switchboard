"""Tiny draw.io (mxGraph) writer: build diagrams in Python, export with the drawio CLI."""
from __future__ import annotations

import html
import subprocess
import sys
from pathlib import Path

FONT = "Inter,Helvetica Neue,Helvetica,Arial,sans-serif"
MONO = "JetBrains Mono,SFMono-Regular,Menlo,monospace"

# palette: zone fill, stroke, ink
P = {
    "user":   ("#fff7ed", "#ea580c", "#7c2d12"),
    "claude": ("#fdf2ec", "#d97757", "#7a2e14"),
    "cf":     ("#fff4e5", "#f38020", "#7a3d00"),
    "pi":     ("#ecfdf5", "#10b981", "#064e3b"),
    "sb":     ("#eef2ff", "#6366f1", "#312e81"),
    "agent":  ("#f5f3ff", "#8b5cf6", "#4c1d95"),
    "work":   ("#f0f9ff", "#0ea5e9", "#0c4a6e"),
    "warn":   ("#fef2f2", "#ef4444", "#7f1d1d"),
    "muted":  ("#f8fafc", "#94a3b8", "#334155"),
    "reuse":  ("#f0fdf4", "#22c55e", "#14532d"),
    "build":  ("#eef2ff", "#4f46e5", "#1e1b4b"),
    "ink":    ("#ffffff", "#0f172a", "#0f172a"),
}


def _style(**kw) -> str:
    return ";".join(f"{k}={v}" for k, v in kw.items() if v is not None) + ";"


class D:
    def __init__(self, name: str, w: int = 1600, h: int = 1000):
        self.name, self.w, self.h = name, w, h
        self.cells: list[str] = []
        self.n = 0

    def _id(self) -> str:
        self.n += 1
        return f"c{self.n}"

    def _cell(self, value: str, style: str, x, y, w, h, parent="1", vertex=True) -> str:
        cid = self._id()
        self.cells.append(
            f'<mxCell id="{cid}" value="{html.escape(value, quote=True)}" style="{style}" '
            f'vertex="1" parent="{parent}"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>'
        )
        return cid

    # zones / containers
    def zone(self, x, y, w, h, title, kind="muted", sub="", dashed=False, r=16, title_size=15):
        f, s, ink = P[kind]
        label = f'<div style="text-align:left"><b style="font-size:{title_size}px;color:{ink}">{title}</b>'
        if sub:
            label += f'<br><span style="font-size:11px;color:{s}">{sub}</span>'
        label += "</div>"
        st = _style(rounded=1 if r else 0, arcSize=r, absoluteArcSize=1,
                    whiteSpace="wrap", html=1, fillColor=f, strokeColor=s, strokeWidth=1.5,
                    dashed=1 if dashed else None, dashPattern="6 4" if dashed else None,
                    verticalAlign="top", align="left", spacingLeft=14, spacingTop=8,
                    fontFamily=FONT, container=1, collapsible=0, shadow=0)
        return self._cell(label, st, x, y, w, h)

    def box(self, x, y, w, h, title, kind="ink", sub="", icon="", fill=None, bold=True, size=13,
            align="center", r=10, stroke_w=1.5, dashed=False, mono_sub=False, shadow=True):
        f, s, ink = P[kind]
        sub_font = MONO if mono_sub else FONT
        t = f'<b>{title}</b>' if bold else title
        label = f'<div style="font-size:{size}px;color:{ink};line-height:1.25">'
        if icon:
            label += f'<span style="font-size:{size + 9}px">{icon}</span><br>'
        label += t
        if sub:
            label += f'<br><span style="font-size:{max(size - 2, 10)}px;color:#475569;font-family:{sub_font};font-weight:normal">{sub}</span>'
        label += "</div>"
        st = _style(rounded=1, arcSize=r, absoluteArcSize=1, whiteSpace="wrap", html=1,
                    fillColor=fill or "#ffffff", strokeColor=s, strokeWidth=stroke_w,
                    dashed=1 if dashed else None, align=align, verticalAlign="middle",
                    spacing=6, fontFamily=FONT, shadow=1 if shadow else 0)
        return self._cell(label, st, x, y, w, h)

    def text(self, x, y, w, h, s, size=12, color="#334155", align="left", bold=False, mono=False, valign="top"):
        body = f"<b>{s}</b>" if bold else s
        st = _style(text=1, html=1, whiteSpace="wrap", align=align, verticalAlign=valign,
                    fontSize=size, fontColor=color, fontFamily=MONO if mono else FONT,
                    strokeColor="none", fillColor="none")
        return self._cell(body, st, x, y, w, h)

    def badge(self, x, y, n, color="#0f172a", d=26):
        st = _style(shape="ellipse", perimeter="ellipsePerimeter", html=1, fillColor=color, strokeColor="#ffffff", strokeWidth=2,
                    fontColor="#ffffff", fontStyle=1, fontSize=13, fontFamily=FONT, shadow=1)
        return self._cell(str(n), st, x, y, d, d)

    def pill(self, x, y, w, h, s, kind="muted", size=11):
        f, st_, ink = P[kind]
        st = _style(rounded=1, arcSize=50, html=1, whiteSpace="wrap", fillColor=f, strokeColor=st_,
                    fontColor=ink, fontSize=size, fontFamily=FONT, fontStyle=1)
        return self._cell(s, st, x, y, w, h)

    def shape(self, x, y, w, h, style, value=""):
        return self._cell(value, style, x, y, w, h)

    def edge(self, a, b, label="", color="#334155", w=2, dashed=False, end="blockThin", start="none",
             curved=False, ortho=True, pts=None, exit=None, entry=None, size=11, flow=False, label_bg="#ffffff"):
        cid = self._id()
        st = _style(
            edgeStyle=None if curved or not ortho else "orthogonalEdgeStyle",
            curved=1 if curved else None, rounded=1, html=1, strokeColor=color, strokeWidth=w,
            dashed=1 if dashed else None, dashPattern="6 4" if dashed else None,
            endArrow=end, endFill=1, startArrow=start, startFill=1, endSize=7, startSize=7,
            fontSize=size, fontFamily=FONT, fontColor=color, labelBackgroundColor=label_bg,
            flowAnimation=1 if flow else None,
            exitX=exit[0] if exit else None, exitY=exit[1] if exit else None,
            entryX=entry[0] if entry else None, entryY=entry[1] if entry else None,
            jumpStyle="arc",
        )
        pts_xml = ""
        if pts:
            pts_xml = "<Array as=\"points\">" + "".join(f'<mxPoint x="{px}" y="{py}"/>' for px, py in pts) + "</Array>"
        self.cells.append(
            f'<mxCell id="{cid}" value="{html.escape(label, quote=True)}" style="{st}" edge="1" parent="1" '
            f'source="{a}" target="{b}"><mxGeometry relative="1" as="geometry">{pts_xml}</mxGeometry></mxCell>'
        )
        return cid

    def line(self, x1, y1, x2, y2, color="#94a3b8", w=1.5, dashed=True, end="none", label="", size=11):
        cid = self._id()
        st = _style(html=1, strokeColor=color, strokeWidth=w, dashed=1 if dashed else None, dashPattern="4 4",
                    endArrow=end, endFill=1, startArrow="none", fontSize=size, fontFamily=FONT, fontColor=color,
                    labelBackgroundColor="#ffffff")
        self.cells.append(
            f'<mxCell id="{cid}" value="{html.escape(label, quote=True)}" style="{st}" edge="1" parent="1">'
            f'<mxGeometry relative="1" as="geometry"><mxPoint x="{x1}" y="{y1}" as="sourcePoint"/>'
            f'<mxPoint x="{x2}" y="{y2}" as="targetPoint"/></mxGeometry></mxCell>'
        )
        return cid

    def xml(self) -> str:
        body = "".join(self.cells)
        return (
            f'<mxfile host="switchboard"><diagram id="{self.name}" name="{self.name}">'
            f'<mxGraphModel dx="{self.w}" dy="{self.h}" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" '
            f'arrows="1" fold="1" page="0" pageScale="1" pageWidth="{self.w}" pageHeight="{self.h}" math="0" shadow="0">'
            f'<root><mxCell id="0"/><mxCell id="1" parent="0"/>{body}</root></mxGraphModel></diagram></mxfile>'
        )

    def save(self, out_dir: Path | str = "."):
        out = Path(out_dir)
        src = out / f"{self.name}.drawio"
        src.write_text(self.xml())
        svg = out / f"{self.name}.svg"
        subprocess.run(["drawio", "-x", "-f", "svg", "-e", "--embed-svg-fonts", "false", "-b", "16", "-o", str(svg), str(src)],
                       check=True, capture_output=True)
        png = out / f"{self.name}.png"
        subprocess.run(["drawio", "-x", "-f", "png", "-s", "1.5", "-b", "16", "-o", str(png), str(src)],
                       check=True, capture_output=True)
        print(f"wrote {src.name}, {svg.name}, {png.name}", file=sys.stderr)
