import ezdxf
# Crown-molding-like test profile, drawn in mm (3.5in wide ~ 88.9mm), no units set to mimic the scaling problem
doc = ezdxf.new("R2010")
msp = doc.modelspace()
msp.add_line((0,0),(88.9,0))
msp.add_line((88.9,0),(88.9,12))
msp.add_arc((70,12),18.9,0,90)          # ends at (70,30.9)
msp.add_line((70,30.9),(20,30.9))
msp.add_lwpolyline([(20,30.9),(10,20),(0,20),(0,0)], format="xy")
doc.saveas("test_profile_nounits.dxf")
doc.header["$INSUNITS"]=4
doc.saveas("test_profile_mm.dxf")
