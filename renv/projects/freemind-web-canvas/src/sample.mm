<?xml version="1.0" encoding="UTF-8"?>
<map version="1.1.0">
<node TEXT="FreeMind Web Canvas">
	<node TEXT="Renderer" POSITION="right" ID="n-renderer">
		<node TEXT="Canvas 2D"/>
		<node TEXT="Bezier edge"/>
		<node TEXT="Zoom &amp; pan"/>
	</node>
	<node TEXT="Model" POSITION="left" STYLE="bubble" ID="n-model">
		<node TEXT="Node tree" FOLDED="true">
			<node TEXT="hidden child"/>
		</node>
		<node TEXT=".mm parse/emit"/>
		<cloud COLOR="#ffff33"/>
	</node>
	<node TEXT="Interaksi" POSITION="right" COLOR="#1a3d7c">
		<node TEXT="Enter = sibling"/>
		<node TEXT="Tab = child"/>
	</node>
	<arrowlink DESTINATION="n-model" COLOR="#6600ff" STARTARROW="None" ENDARROW="Default" STARTINCLINATION="30;0;" ENDINCLINATION="30;0;"/>
</node>
</map>
