package com.cloudweather.xiaoyu;
import org.json.JSONObject;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
public class WallPackageTest {
    static void check(boolean b, String name) { if (!b) throw new AssertionError(name); System.out.println("PASS " + name); }
    static void u32(RandomAccessFile f,long n)throws Exception{f.writeInt(Integer.reverseBytes((int)n));}
    static void text(RandomAccessFile f,String s)throws Exception{byte[] b=s.getBytes(StandardCharsets.UTF_8);u32(f,b.length);f.write(b);}
    static byte[] digest(File f)throws Exception {MessageDigest h=MessageDigest.getInstance("SHA-256");byte[] b=new byte[262144];try(InputStream in=new FileInputStream(f)){int n;while((n=in.read(b))!=-1)h.update(b,0,n);}return h.digest();}
    public static void main(String[] args)throws Exception{
      File root=new File(args[0]);root.mkdirs();
      File big=new File(root,"large.mpkg");long size=600L*1024*1024;
      byte[] pj="{\"type\":\"video\",\"file\":\"movie.mp4\"}".getBytes(StandardCharsets.UTF_8);
      try(RandomAccessFile f=new RandomAccessFile(big,"rw")){text(f,"PKGM0014");u32(f,2);text(f,"project.json");u32(f,0);u32(f,pj.length);text(f,"movie.mp4");u32(f,pj.length);u32(f,size);f.write(pj);long start=f.getFilePointer();f.setLength(start+size);f.seek(start);f.write(new byte[]{1,2,3,4});f.seek(start+size-4);f.write(new byte[]{5,6,7,8});}
      JSONObject result=WallPackage.extract(big);File movie=new File(new URI(result.getString("mediaPath")));check(movie.length()==size,"600 MiB video package streams without size cap");
      try(RandomAccessFile f=new RandomAccessFile(movie,"r")){check(f.readInt()==0x01020304,"streamed first bytes unchanged");f.seek(size-4);check(f.readInt()==0x05060708,"streamed last bytes unchanged");}
      WallPackage.remove(WallPackage.directory(big));big.delete();
      File escape=new File(root,"bad.pkg");try(RandomAccessFile f=new RandomAccessFile(escape,"rw")){text(f,"PKGV0001");u32(f,1);text(f,"../outside.bin");u32(f,0);u32(f,1);f.write(1);}
      boolean rejected=false;try{WallPackage.extract(escape);}catch(Exception e){rejected=true;}check(rejected&&!new File(root,"outside.bin").exists(),"invalid package path rejected and cleaned");escape.delete();
      File original=new File(args[1]);JSONObject extracted=WallPackage.extract(original);JSONObject files=new JSONObject(new String(java.nio.file.Files.readAllBytes(new File(new URI(extracted.getString("pack"))).toPath()),StandardCharsets.UTF_8)).getJSONObject("files");
      try(RandomAccessFile f=new RandomAccessFile(original,"r")){
        int v=Integer.reverseBytes(f.readInt());f.skipBytes(v);int count=Integer.reverseBytes(f.readInt());List<String> names=new ArrayList<>();List<Long> offsets=new ArrayList<>(),sizes=new ArrayList<>();
        for(int i=0;i<count;i++){int n=Integer.reverseBytes(f.readInt());byte[] b=new byte[n];f.readFully(b);names.add(new String(b,StandardCharsets.UTF_8));offsets.add(Integer.toUnsignedLong(Integer.reverseBytes(f.readInt())));sizes.add(Integer.toUnsignedLong(Integer.reverseBytes(f.readInt())));}
        long start=f.getFilePointer();byte[] block=new byte[262144];
        for(int i=0;i<count;i++){MessageDigest h=MessageDigest.getInstance("SHA-256");f.seek(start+offsets.get(i));long left=sizes.get(i);while(left>0){int n=f.read(block,0,(int)Math.min(left,block.length));if(n<0)throw new EOFException();h.update(block,0,n);left-=n;}File part=new File(new URI(files.getString(names.get(i))));check(Arrays.equals(h.digest(),digest(part)),"lossless asset "+names.get(i));}
      }
      WallPackage.remove(WallPackage.directory(original));
    }
}
