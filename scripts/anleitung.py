from pathlib import Path
import re,html,json,sys
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
# Aufruf: python3 scripts/anleitung.py beispiel                    (eingebautes Profil)
#         python3 scripts/anleitung.py ../Inkform-Studios/<studio>  (Studio-Profil)
# Liest <profil>/Dokumente/Anleitung.md und schreibt <profil>/Anleitung-iPad-und-Admin.pdf.
root=Path(__file__).resolve().parents[1]
if len(sys.argv)!=2:sys.exit('Aufruf: python3 scripts/anleitung.py <profil oder pfad>')
profile_dir=root/'profiles'/sys.argv[1] if re.fullmatch(r'[a-z0-9-]+',sys.argv[1]) else Path(sys.argv[1]).resolve();guide=json.loads((profile_dir/'profile.json').read_text(encoding='utf-8'))['guide']
source=profile_dir/'Dokumente'/'Anleitung.md';output=profile_dir/'Anleitung-iPad-und-Admin.pdf'
pdfmetrics.registerFont(TTFont('Guide','/System/Library/Fonts/Supplemental/Arial.ttf'))
pdfmetrics.registerFont(TTFont('GuideBold','/System/Library/Fonts/Supplemental/Arial Bold.ttf'))
styles={
 'title':ParagraphStyle('title',fontName='GuideBold',fontSize=22,leading=27,spaceAfter=18,textColor=colors.HexColor('#181818')),
 'head':ParagraphStyle('head',fontName='GuideBold',fontSize=12,leading=16,spaceBefore=13,spaceAfter=7,keepWithNext=True),
 'body':ParagraphStyle('body',fontName='Guide',fontSize=9.5,leading=14,spaceAfter=9),
 'bullet':ParagraphStyle('bullet',fontName='Guide',fontSize=9.5,leading=14,leftIndent=12,firstLineIndent=-9,spaceAfter=7),
 'cell':ParagraphStyle('cell',fontName='Guide',fontSize=9,leading=13,spaceAfter=0),
 'cellhead':ParagraphStyle('cellhead',fontName='GuideBold',fontSize=9,leading=13,textColor=colors.white),
}
def inline(text):
 text=html.escape(text)
 return re.sub(r'\[([^\]]+)\]\((https://[^)]+)\)',r'<link href="\2" color="#333333"><u>\1</u></link>',text)
def footer(c,doc):
 w,h=doc.pagesize
 c.setFillColor(colors.HexColor('#111111'));c.rect(0,h-46,w,46,fill=1,stroke=0)
 c.setFont('GuideBold',10);c.setFillColor(colors.white);c.drawString(44,h-28,guide['header'])
 c.setFont('Guide',8);c.drawRightString(w-44,h-28,'Einrichtung und Bedienung')
 c.setStrokeColor(colors.HexColor('#dddddd'));c.line(44,42,w-44,42)
 c.setFillColor(colors.HexColor('#666666'));c.setFont('Guide',8);c.drawString(44,28,f"Stand {guide['date']} · lokal · für den Inhaber");c.drawRightString(w-44,28,f'{doc.page}')
lines=source.read_text().splitlines();story=[];i=0;first=True
while i<len(lines):
 line=lines[i].strip()
 if not line:i+=1;continue
 if line.startswith('# '):
  if not first:story.append(PageBreak())
  first=False;story.append(Paragraph(inline(line[2:]),styles['title']));i+=1;continue
 if line.startswith('## '):story.append(Paragraph(inline(line[3:]),styles['head']));i+=1;continue
 if line.startswith('| '):
  rows=[]
  while i<len(lines) and lines[i].strip().startswith('|'):
   cells=[x.strip() for x in lines[i].strip().strip('|').split('|')]
   rowstyle=styles['cellhead'] if not rows else styles['cell']
   rows.append([Paragraph(inline(x),rowstyle) for x in cells]);i+=1
  t=Table(rows,colWidths=[132,375],repeatRows=1,hAlign='LEFT')
  t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#222222')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#f5f5f5'),colors.white]),('LINEBELOW',(0,0),(-1,-1),.5,colors.HexColor('#dddddd'))]))
  story.extend([t,Spacer(1,8)]);continue
 if line.startswith('- '):story.append(Paragraph('• '+inline(line[2:]),styles['bullet']));i+=1;continue
 story.append(Paragraph(inline(line),styles['body']));i+=1
SimpleDocTemplate(str(output),pagesize=(595.28,841.89),leftMargin=44,rightMargin=44,topMargin=69,bottomMargin=58,title='Inkform - iPad und Admin-Anleitung',author=guide['author'],subject='Lokale Einrichtung, PIN, Kundenformular, Einnahmen und Sicherungen').build(story,onFirstPage=footer,onLaterPages=footer)
print(output)
